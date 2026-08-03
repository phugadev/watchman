import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  escalationPolicies,
  escalationSteps,
  incidentEvents,
  incidents,
  monitors,
  MAX_ESCALATION_REPEATS,
} from "@/lib/db/schema";
import { notifyChannel } from "@/lib/notify";
import type { ProbeResult } from "@/lib/probe/types";
import { buildPayload, maintenanceState } from "./engine";
import { describeLevel, planEscalation, type EscalationStep } from "./escalation";

/**
 * Escalate incidents nobody has acknowledged.
 *
 * Time-driven rather than event-driven: nothing happens when an incident is
 * ignored, so there is no event to hang this off. The scheduler calls it on a
 * timer and it asks the same question every pass — for each open incident, has
 * enough time gone by that the next step is due?
 *
 * Kept out of `engine.ts` deliberately. That module runs inside the check path,
 * where every millisecond is a probe delayed; this runs beside it.
 */
export async function sweepEscalations(now = new Date()): Promise<number> {
  const open = db
    .select({ incident: incidents, monitor: monitors })
    .from(incidents)
    .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(
      and(
        // "acknowledged" and "resolved" are both other statuses, so this single
        // predicate is what makes acknowledging an incident stop the paging.
        eq(incidents.status, "open"),
        eq(incidents.suppressed, false),
        // A flapping incident does not page on open, and escalating it would
        // reintroduce exactly the noise the flap flag exists to suppress.
        eq(incidents.flapping, false),
        isNotNull(monitors.escalationPolicyId),
      ),
    )
    .all();

  if (open.length === 0) return 0;

  const policyIds = [
    ...new Set(open.map((r) => r.monitor.escalationPolicyId!).filter(Boolean)),
  ];

  const policies = new Map(
    db
      .select()
      .from(escalationPolicies)
      .where(inArray(escalationPolicies.id, policyIds))
      .all()
      .map((p) => [p.id, p]),
  );

  const stepsByPolicy = new Map<string, EscalationStep[]>();
  for (const step of db
    .select()
    .from(escalationSteps)
    .where(inArray(escalationSteps.policyId, policyIds))
    .all()) {
    const list = stepsByPolicy.get(step.policyId) ?? [];
    list.push({
      position: step.position,
      afterSec: step.afterSec,
      channelId: step.channelId,
    });
    stepsByPolicy.set(step.policyId, list);
  }

  const pending: Array<() => Promise<void>> = [];

  for (const { incident, monitor } of open) {
    const policy = policies.get(monitor.escalationPolicyId!);
    if (!policy) continue;

    const steps = stepsByPolicy.get(policy.id) ?? [];
    if (steps.length === 0) continue;

    // A maintenance window opened *after* the incident did should also stop the
    // escalation. The incident's own `suppressed` flag only records how things
    // stood when it opened.
    if (maintenanceState(monitor.id, now).suppressAlerts) continue;

    const elapsedMs = now.getTime() - incident.startedAt.getTime();
    const plan = planEscalation({
      steps,
      repeatSec: policy.repeatSec,
      elapsedSec: Math.floor(elapsedMs / 1000),
      firedCount: incident.escalationLevel,
      maxRepeats: MAX_ESCALATION_REPEATS,
    });

    if (plan.fire.length === 0) continue;

    /*
     * The level is committed before the notifications are attempted, not after.
     *
     * That means a delivery which fails outright is not retried on the next
     * sweep — deliverWithRetry has already made its attempts, and a channel that
     * is permanently broken would otherwise pin the whole policy at one level and
     * re-page every other step in it every fifteen seconds, forever.
     */
    db.transaction((tx) => {
      tx.update(incidents)
        .set({ escalationLevel: plan.nextLevel })
        .where(eq(incidents.id, incident.id))
        .run();

      tx.insert(incidentEvents)
        .values({
          incidentId: incident.id,
          at: now,
          kind: "escalated",
          message: `Escalated to ${describeLevel(plan.nextLevel, steps.length)} of "${policy.name}" — unacknowledged for ${Math.round(elapsedMs / 60_000)}m`,
          meta: JSON.stringify({
            level: plan.nextLevel,
            policyId: policy.id,
            channelIds: plan.fire.map((s) => s.channelId),
          }),
        })
        .run();
    });

    // Dispatched after the transaction commits, for the same reason the check
    // path does it: a SQLite write lock held across a network call blocks every
    // probe in flight.
    const escalation = {
      level: plan.nextLevel,
      policyName: policy.name,
      unacknowledgedForMs: elapsedMs,
    };

    // There is no fresh probe here — the last recorded state is what the incident
    // is still doing, and re-probing from the sweep would race the scheduler.
    const lastKnown: ProbeResult = {
      ok: false,
      status: "down",
      latencyMs: monitor.lastLatencyMs,
      error: monitor.lastError ?? incident.cause,
    };

    for (const step of plan.fire) {
      pending.push(async () => {
        await notifyChannel({
          channelId: step.channelId,
          monitorId: monitor.id,
          incidentId: incident.id,
          kind: "escalated",
          payload: buildPayload({
            monitor,
            event: "monitor.escalated",
            result: lastKnown,
            incident: {
              id: incident.id,
              startedAt: incident.startedAt,
              cause: incident.cause,
              escalation,
            },
          }),
        });
      });
    }
  }

  await Promise.allSettled(pending.map((fn) => fn()));
  return pending.length;
}
