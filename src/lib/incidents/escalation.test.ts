import { describe, expect, it } from "vitest";
import { describeLevel, planEscalation, type EscalationStep } from "./escalation";

const steps: EscalationStep[] = [
  { position: 1, afterSec: 0, channelId: "telegram" },
  { position: 2, afterSec: 300, channelId: "email" },
  { position: 3, afterSec: 900, channelId: "pager" },
];

const plan = (over: Partial<Parameters<typeof planEscalation>[0]> = {}) =>
  planEscalation({
    steps,
    repeatSec: null,
    elapsedSec: 0,
    firedCount: 0,
    maxRepeats: 10,
    ...over,
  });

describe("planEscalation", () => {
  it("does nothing for a policy with no steps", () => {
    expect(plan({ steps: [], elapsedSec: 10_000 })).toEqual({
      fire: [],
      nextLevel: 0,
    });
  });

  it("fires the first step as soon as its time has come", () => {
    const r = plan({ elapsedSec: 0 });
    expect(r.fire.map((s) => s.channelId)).toEqual(["telegram"]);
    expect(r.nextLevel).toBe(1);
  });

  it("sends nothing when the next step is not yet due", () => {
    expect(plan({ elapsedSec: 299, firedCount: 1 })).toEqual({
      fire: [],
      nextLevel: 1,
    });
  });

  it("advances one step at a time as the incident ages", () => {
    expect(plan({ elapsedSec: 300, firedCount: 1 }).fire.map((s) => s.channelId)).toEqual(
      ["email"],
    );
    expect(plan({ elapsedSec: 900, firedCount: 2 }).fire.map((s) => s.channelId)).toEqual(
      ["pager"],
    );
  });

  it("is idempotent — re-running with the level already stored sends nothing", () => {
    expect(plan({ elapsedSec: 1000, firedCount: 3 })).toEqual({
      fire: [],
      nextLevel: 3,
    });
  });

  it("catches up after a restart without re-notifying what already went out", () => {
    // Watchman was down; the incident is 20 minutes old and only step 1 had fired.
    const r = plan({ elapsedSec: 1200, firedCount: 1 });
    expect(r.fire.map((s) => s.channelId)).toEqual(["email", "pager"]);
    expect(r.nextLevel).toBe(3);
  });

  it("stops at the last step when the policy does not repeat", () => {
    expect(plan({ elapsedSec: 86_400, firedCount: 3 })).toEqual({
      fire: [],
      nextLevel: 3,
    });
  });

  describe("repeats", () => {
    it("re-fires the last step once per interval", () => {
      expect(
        plan({ repeatSec: 600, elapsedSec: 1500, firedCount: 3 }).fire.map(
          (s) => s.channelId,
        ),
      ).toEqual(["pager"]);
      expect(plan({ repeatSec: 600, elapsedSec: 1500, firedCount: 3 }).nextLevel).toBe(
        4,
      );
    });

    it("does not repeat before the interval has elapsed", () => {
      expect(plan({ repeatSec: 600, elapsedSec: 1499, firedCount: 3 }).fire).toEqual(
        [],
      );
    });

    it("collapses a backlog of repeats into one notification", () => {
      // Six repeat intervals passed while nobody was looking. Sending six copies
      // of the same page is the behaviour this collapsing exists to prevent.
      const r = plan({ repeatSec: 600, elapsedSec: 4_500, firedCount: 3 });
      expect(r.fire).toHaveLength(1);
      expect(r.fire[0]!.channelId).toBe("pager");
      // The level still jumps to where it actually is, so the next repeat is due
      // one interval from now rather than immediately.
      expect(r.nextLevel).toBe(9);
    });

    it("stops repeating at the cap", () => {
      const r = plan({
        repeatSec: 600,
        elapsedSec: 30 * 86_400,
        firedCount: 13,
        maxRepeats: 10,
      });
      expect(r.fire).toEqual([]);
      expect(r.nextLevel).toBe(13);
    });
  });

  it("notifies a channel once even when two steps name it", () => {
    const r = planEscalation({
      steps: [
        { position: 1, afterSec: 0, channelId: "oncall" },
        { position: 2, afterSec: 60, channelId: "oncall" },
      ],
      repeatSec: null,
      elapsedSec: 120,
      firedCount: 0,
      maxRepeats: 10,
    });

    expect(r.fire).toHaveLength(1);
    // The furthest step wins, so the timeline records where it actually got to.
    expect(r.fire[0]!.position).toBe(2);
    expect(r.nextLevel).toBe(2);
  });

  it("orders what it fires by position, not by insertion", () => {
    const r = planEscalation({
      steps: [
        { position: 3, afterSec: 900, channelId: "pager" },
        { position: 1, afterSec: 0, channelId: "telegram" },
        { position: 2, afterSec: 300, channelId: "email" },
      ],
      repeatSec: null,
      elapsedSec: 1000,
      firedCount: 0,
      maxRepeats: 10,
    });

    expect(r.fire.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it("handles steps that share a due time", () => {
    const r = planEscalation({
      steps: [
        { position: 1, afterSec: 0, channelId: "a" },
        { position: 2, afterSec: 0, channelId: "b" },
      ],
      repeatSec: null,
      elapsedSec: 0,
      firedCount: 0,
      maxRepeats: 10,
    });

    expect(r.fire.map((s) => s.channelId)).toEqual(["a", "b"]);
    expect(r.nextLevel).toBe(2);
  });
});

describe("describeLevel", () => {
  it("names a real step by its position", () => {
    expect(describeLevel(2, 3)).toBe("step 2 of 3");
  });

  it("describes a level past the last step as a repeat, not 'step 7 of 3'", () => {
    expect(describeLevel(4, 3)).toBe("repeat 1 after step 3");
    expect(describeLevel(7, 3)).toBe("repeat 4 after step 3");
  });
});
