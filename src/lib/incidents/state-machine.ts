import type { CheckStatus } from "@/lib/probe/types";
import type { MonitorStatus } from "@/lib/metrics/uptime";

/**
 * The incident state machine.
 *
 * Kept as one pure function, separate from all database work, because this is
 * where the subtle bugs in a monitoring tool live: alerting one check too early
 * pages people for network lint, one check too late misses short outages, and
 * getting recovery wrong leaves incidents open forever. Every rule here is
 * directly unit-testable as a result.
 */

/** How many incidents in the flap window before a monitor is called unstable. */
export const FLAP_THRESHOLD = 4;
/** Window over which flapping is measured. */
export const FLAP_WINDOW_MS = 60 * 60_000;

export type Effect =
  | { type: "open_incident"; cause: string | null; failedChecks: number }
  | { type: "resolve_incident" }
  /**
   * Degraded is reported but never opens an incident. A slow endpoint is a real
   * signal, yet it is not an outage, and treating it as one produces alert
   * fatigue that trains people to ignore the channel. Channels opt in
   * individually via notifyOnDegraded.
   */
  | { type: "notify_degraded"; detail: string | null }
  | { type: "mark_flapping" };

export interface MachineInput {
  /** The status the probe just returned. */
  result: { status: CheckStatus; error?: string | null };
  state: {
    lastStatus: MonitorStatus;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    /** Whether an unresolved incident already exists for this monitor. */
    hasOpenIncident: boolean;
    /** Set once the monitor has already been flagged unstable. */
    flapping: boolean;
  };
  policy: {
    confirmFailures: number;
    confirmRecoveries: number;
  };
  /** Incidents opened for this monitor inside FLAP_WINDOW_MS. */
  recentIncidents: number;
}

export interface MachineOutput {
  /** The monitor's new denormalised status. */
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  effects: Effect[];
  /** True when the status column actually changed, for timeline and SSE. */
  changed: boolean;
}

export function decide(input: MachineInput): MachineOutput {
  const { result, state, policy } = input;
  const confirmFailures = Math.max(1, policy.confirmFailures);
  const confirmRecoveries = Math.max(1, policy.confirmRecoveries);
  const effects: Effect[] = [];

  let consecutiveFailures = state.consecutiveFailures;
  let consecutiveSuccesses = state.consecutiveSuccesses;

  if (result.status === "down") {
    consecutiveFailures += 1;
    consecutiveSuccesses = 0;

    // Confirmation delay is the whole point: a single failed check is usually a
    // dropped packet, not an outage. Alert only once the failure repeats.
    if (!state.hasOpenIncident && consecutiveFailures >= confirmFailures) {
      // A monitor that has already opened several incidents this hour is
      // unstable rather than newly broken. Flag it so the notifier can fall
      // silent — twenty pages an hour trains people to mute the channel, which
      // is worse than missing one alert.
      if (!state.flapping && input.recentIncidents >= FLAP_THRESHOLD) {
        effects.push({ type: "mark_flapping" });
      }
      effects.push({
        type: "open_incident",
        cause: result.error ?? null,
        failedChecks: consecutiveFailures,
      });
    }
  } else {
    // Both up and degraded count as a success: the target responded. Counting
    // degraded as downtime would double-penalise latency, which the grade
    // already scores separately.
    consecutiveSuccesses += 1;
    consecutiveFailures = 0;

    if (state.hasOpenIncident && consecutiveSuccesses >= confirmRecoveries) {
      effects.push({ type: "resolve_incident" });
    }

    // Notify on the transition into degraded only, not on every slow check
    // thereafter — otherwise a persistently slow endpoint notifies once per
    // interval, forever.
    if (result.status === "degraded" && state.lastStatus !== "degraded") {
      effects.push({ type: "notify_degraded", detail: result.error ?? null });
    }
  }

  /*
   * The stored status mirrors the last check verbatim, without waiting for
   * confirmation. The dashboard should show what the probe actually saw — hiding
   * a real failure behind the confirmation window would make the uptime tape
   * disagree with the check history. Confirmation gates *incidents and alerts*,
   * not the display.
   */
  const status: MonitorStatus = result.status;

  return {
    status,
    consecutiveFailures,
    consecutiveSuccesses,
    effects,
    changed: status !== state.lastStatus,
  };
}
