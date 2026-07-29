import { describe, expect, it } from "vitest";
import {
  FLAP_THRESHOLD,
  decide,
  type Effect,
  type MachineInput,
} from "./state-machine";

const base: MachineInput = {
  result: { status: "up", error: null },
  state: {
    lastStatus: "up",
    consecutiveFailures: 0,
    consecutiveSuccesses: 5,
    hasOpenIncident: false,
    flapping: false,
  },
  policy: { confirmFailures: 2, confirmRecoveries: 2 },
  recentIncidents: 0,
};

/** Override any leaf of the input; `Partial` alone would demand whole sub-objects. */
type Overrides = {
  [K in keyof MachineInput]?: MachineInput[K] extends object
    ? Partial<MachineInput[K]>
    : MachineInput[K];
};

const run = (over: Overrides) =>
  decide({
    ...base,
    ...over,
    result: { ...base.result, ...over.result },
    state: { ...base.state, ...over.state },
    policy: { ...base.policy, ...over.policy },
  });

const types = (effects: Effect[]) => effects.map((e) => e.type);

describe("decide — opening incidents", () => {
  // The core anti-noise rule: one failed check is usually a dropped packet.
  it("does not open an incident on the first failure", () => {
    const r = run({ result: { status: "down", error: "boom" } });
    expect(types(r.effects)).toEqual([]);
    expect(r.consecutiveFailures).toBe(1);
  });

  it("opens once the failure count reaches the threshold", () => {
    const r = run({
      result: { status: "down", error: "ECONNREFUSED" },
      state: { consecutiveFailures: 1 },
    });
    expect(types(r.effects)).toEqual(["open_incident"]);
    const opened = r.effects[0];
    expect(opened).toMatchObject({ cause: "ECONNREFUSED", failedChecks: 2 });
  });

  it("opens on the first failure when confirmFailures is 1", () => {
    const r = run({
      result: { status: "down", error: "x" },
      policy: { confirmFailures: 1, confirmRecoveries: 1 },
    });
    expect(types(r.effects)).toEqual(["open_incident"]);
  });

  it("treats a confirmFailures below 1 as 1 rather than never alerting", () => {
    const r = run({
      result: { status: "down", error: "x" },
      policy: { confirmFailures: 0, confirmRecoveries: 2 },
    });
    expect(types(r.effects)).toEqual(["open_incident"]);
  });

  // An incident already exists; continuing failures must not open more.
  it("does not open a second incident while one is open", () => {
    const r = run({
      result: { status: "down", error: "still down" },
      state: { consecutiveFailures: 9, hasOpenIncident: true, lastStatus: "down" },
    });
    expect(types(r.effects)).toEqual([]);
    expect(r.consecutiveFailures).toBe(10);
  });
});

describe("decide — resolving incidents", () => {
  it("does not resolve on a single success", () => {
    const r = run({
      result: { status: "up" },
      state: { lastStatus: "down", hasOpenIncident: true, consecutiveSuccesses: 0 },
    });
    expect(types(r.effects)).toEqual([]);
    expect(r.consecutiveSuccesses).toBe(1);
  });

  it("resolves once recoveries reach the threshold", () => {
    const r = run({
      result: { status: "up" },
      state: { lastStatus: "down", hasOpenIncident: true, consecutiveSuccesses: 1 },
    });
    expect(types(r.effects)).toEqual(["resolve_incident"]);
  });

  // Degraded means the target answered, so it must be able to close an incident;
  // otherwise a service that recovers into a slow state stays "down" forever.
  it("lets a degraded check resolve an open incident", () => {
    const r = run({
      result: { status: "degraded", error: "slow" },
      state: { lastStatus: "down", hasOpenIncident: true, consecutiveSuccesses: 1 },
    });
    expect(types(r.effects)).toContain("resolve_incident");
    expect(r.status).toBe("degraded");
  });

  it("does not emit a resolve when nothing is open", () => {
    const r = run({ result: { status: "up" }, state: { hasOpenIncident: false } });
    expect(types(r.effects)).toEqual([]);
  });
});

describe("decide — counters", () => {
  it("clears the failure streak on success", () => {
    const r = run({ result: { status: "up" }, state: { consecutiveFailures: 7 } });
    expect(r.consecutiveFailures).toBe(0);
  });

  it("clears the success streak on failure", () => {
    const r = run({
      result: { status: "down", error: "x" },
      state: { consecutiveSuccesses: 7 },
    });
    expect(r.consecutiveSuccesses).toBe(0);
  });
});

describe("decide — degraded notifications", () => {
  it("notifies on the transition into degraded", () => {
    const r = run({
      result: { status: "degraded", error: "1400ms > 500ms" },
      state: { lastStatus: "up" },
    });
    expect(types(r.effects)).toEqual(["notify_degraded"]);
  });

  // A persistently slow endpoint must not notify once per interval forever.
  it("stays silent while it remains degraded", () => {
    const r = run({
      result: { status: "degraded", error: "slow" },
      state: { lastStatus: "degraded" },
    });
    expect(types(r.effects)).toEqual([]);
  });

  it("never opens an incident for degraded", () => {
    for (let i = 0; i < 10; i++) {
      const r = run({
        result: { status: "degraded", error: "slow" },
        state: { lastStatus: "degraded", consecutiveFailures: i },
      });
      expect(types(r.effects)).not.toContain("open_incident");
    }
  });
});

describe("decide — flap dampening", () => {
  it("flags flapping when opening past the threshold", () => {
    const r = run({
      result: { status: "down", error: "x" },
      state: { consecutiveFailures: 1 },
      recentIncidents: FLAP_THRESHOLD,
    });
    expect(types(r.effects)).toEqual(["mark_flapping", "open_incident"]);
  });

  it("does not re-flag an already flapping monitor", () => {
    const r = run({
      result: { status: "down", error: "x" },
      state: { consecutiveFailures: 1, flapping: true },
      recentIncidents: FLAP_THRESHOLD + 5,
    });
    expect(types(r.effects)).toEqual(["open_incident"]);
  });

  it("leaves a stable monitor unflagged", () => {
    const r = run({
      result: { status: "down", error: "x" },
      state: { consecutiveFailures: 1 },
      recentIncidents: FLAP_THRESHOLD - 1,
    });
    expect(types(r.effects)).toEqual(["open_incident"]);
  });
});

describe("decide — reported status", () => {
  // The stored status mirrors the probe verbatim. If it waited for confirmation,
  // the uptime tape would disagree with the check history for the same minute.
  it("reports down on the first failure even without an incident", () => {
    const r = run({ result: { status: "down", error: "x" } });
    expect(r.status).toBe("down");
    expect(r.changed).toBe(true);
  });

  it("marks changed only on an actual transition", () => {
    expect(run({ result: { status: "up" }, state: { lastStatus: "up" } }).changed).toBe(
      false,
    );
    expect(
      run({ result: { status: "up" }, state: { lastStatus: "down" } }).changed,
    ).toBe(true);
  });
});
