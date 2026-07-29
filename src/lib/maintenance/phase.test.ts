import { describe, expect, it } from "vitest";
import { maintenancePhase } from "./phase";

const now = new Date("2026-07-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
const MIN = 60_000;

describe("maintenancePhase", () => {
  it("is scheduled before it starts", () => {
    expect(maintenancePhase(at(10 * MIN), at(70 * MIN), now)).toBe("scheduled");
  });

  it("is active inside the window", () => {
    expect(maintenancePhase(at(-10 * MIN), at(50 * MIN), now)).toBe("active");
  });

  it("is finished after it ends", () => {
    expect(maintenancePhase(at(-70 * MIN), at(-10 * MIN), now)).toBe("finished");
  });

  /*
   * Both bounds inclusive, matching the engine's `startsAt <= now AND endsAt >= now`.
   * If the UI and the engine disagreed at a boundary, a window could read as finished
   * while alerts were still being suppressed — the exact confusion maintenance windows
   * are supposed to prevent.
   */
  it("is active at the exact start", () => {
    expect(maintenancePhase(now, at(60 * MIN), now)).toBe("active");
  });

  it("is active at the exact end", () => {
    expect(maintenancePhase(at(-60 * MIN), now, now)).toBe("active");
  });

  it("goes finished one millisecond past the end", () => {
    expect(maintenancePhase(at(-60 * MIN), at(-1), now)).toBe("finished");
  });

  it("goes active one millisecond past the start", () => {
    expect(maintenancePhase(at(-1), at(60 * MIN), now)).toBe("active");
  });

  // An "end now" click sets endsAt to the current instant; a zero-length window must
  // not read as still active on the next render.
  it("treats a zero-length window at now as active, and stale one ms later", () => {
    expect(maintenancePhase(now, now, now)).toBe("active");
    expect(maintenancePhase(at(-1), at(-1), now)).toBe("finished");
  });
});
