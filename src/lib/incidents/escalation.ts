/**
 * Escalation scheduling.
 *
 * Pure: takes a policy, how long an incident has been open, and how much has
 * already been sent, and returns what to send now. No database, no clock, no
 * network — the sweep in `sweep.ts` supplies all three.
 */

export interface EscalationStep {
  /** 1-based order within the policy. */
  position: number;
  /** Seconds after the incident opened at which this step fires. */
  afterSec: number;
  channelId: string;
}

export interface EscalationPlan {
  /** Steps to notify right now, in order. Empty when nothing is due. */
  fire: EscalationStep[];
  /**
   * The level to store afterwards. Always >= firedCount; equal when nothing is
   * due, which is the signal to skip the write entirely.
   */
  nextLevel: number;
}

/**
 * Work out which escalation steps are due.
 *
 * Levels 1..N map to the policy's steps. Beyond N, if the policy repeats, level
 * N+k is the last step again at `afterSec + k * repeatSec`.
 *
 * Two properties matter more than the arithmetic:
 *
 * - **Idempotent.** The caller passes what has already fired, so running the
 *   sweep twice, or restarting mid-escalation, sends nothing extra.
 * - **Collapsing.** When several levels come due at once — Watchman was down, or
 *   the incident opened during a long tick — the steps are deduplicated by
 *   channel and sent once each, not once per skipped level. Waking up to fifteen
 *   copies of the same page is how a channel gets muted.
 */
export function planEscalation({
  steps,
  repeatSec,
  elapsedSec,
  firedCount,
  maxRepeats,
}: {
  steps: EscalationStep[];
  repeatSec?: number | null;
  elapsedSec: number;
  firedCount: number;
  maxRepeats: number;
}): EscalationPlan {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return { fire: [], nextLevel: firedCount };

  const last = ordered[ordered.length - 1]!;
  const repeats = repeatSec && repeatSec > 0 ? maxRepeats : 0;
  const maxLevel = ordered.length + repeats;

  // Highest level whose scheduled time has passed.
  let dueLevel = 0;
  for (let level = 1; level <= maxLevel; level++) {
    const at =
      level <= ordered.length
        ? ordered[level - 1]!.afterSec
        : last.afterSec + (level - ordered.length) * (repeatSec ?? 0);

    if (at <= elapsedSec) dueLevel = level;
    else break;
  }

  if (dueLevel <= firedCount) return { fire: [], nextLevel: firedCount };

  const pending: EscalationStep[] = [];
  for (let level = firedCount + 1; level <= dueLevel; level++) {
    pending.push(level <= ordered.length ? ordered[level - 1]! : last);
  }

  // Deduplicate by channel, keeping the furthest step — a policy whose steps two
  // and three name the same channel should notify it once, describing the point
  // it actually reached.
  const byChannel = new Map<string, EscalationStep>();
  for (const step of pending) byChannel.set(step.channelId, step);

  return {
    fire: [...byChannel.values()].sort((a, b) => a.position - b.position),
    nextLevel: dueLevel,
  };
}

/**
 * Describe a level for the incident timeline.
 *
 * Levels past the last step are repeats of it, and saying "step 7 of 3" would be
 * nonsense to whoever reads the timeline afterwards.
 */
export function describeLevel(level: number, stepCount: number): string {
  if (stepCount === 0) return `escalation ${level}`;
  if (level <= stepCount) return `step ${level} of ${stepCount}`;
  return `repeat ${level - stepCount} after step ${stepCount}`;
}
