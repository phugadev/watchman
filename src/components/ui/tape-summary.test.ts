import { describe, expect, it } from "vitest";
import { summariseTape, type TapeBucket } from "./status";

const bucket = (
  status: TapeBucket["status"],
  label = "day",
): TapeBucket => ({ label, status });

const many = (status: TapeBucket["status"], n: number) =>
  Array.from({ length: n }, () => bucket(status));

/*
 * This string is the *entire* content of the uptime tape for anyone using a screen
 * reader — the bars themselves are decorative divs. If it is wrong or vague, the
 * graphic conveys nothing to them, which is the bug this replaced.
 */
describe("summariseTape", () => {
  it("handles an empty tape", () => {
    expect(summariseTape([])).toBe("Uptime history: no data yet.");
  });

  it("states the period count and the reading order", () => {
    const s = summariseTape(many("up", 90));
    expect(s).toContain("90 periods");
    // Which end is "now" is not inferable without sight.
    expect(s).toContain("oldest first");
  });

  it("leads with the verdict, not a statistic", () => {
    expect(summariseTape(many("up", 90))).toContain("No outages recorded");
  });

  it("counts outages and puts them first", () => {
    const s = summariseTape([...many("up", 88), bucket("down"), bucket("down")]);
    expect(s).toContain("2 periods with an outage");
    expect(s).toContain("88 fully operational");
  });

  it("uses the singular for one outage", () => {
    expect(summariseTape([...many("up", 5), bucket("down")])).toContain(
      "1 period with an outage",
    );
  });

  // Degradation is not an outage, and saying "no outages" while hiding it would be
  // the same class of half-truth the old label had.
  it("distinguishes degraded from down", () => {
    const s = summariseTape([...many("up", 80), ...many("degraded", 10)]);
    expect(s).toContain("No outages, but some periods were degraded");
    expect(s).toContain("10 degraded");
  });

  it("does not claim data it does not have", () => {
    const s = summariseTape(many("pending", 90));
    expect(s).toContain("No data recorded yet");
    expect(s).toContain("90 with no data");
    expect(s).not.toContain("operational");
  });

  it("reports partial history honestly", () => {
    const s = summariseTape([...many("pending", 59), ...many("up", 31)]);
    expect(s).toContain("31 fully operational");
    expect(s).toContain("59 with no data");
  });

  it("omits categories with no members rather than saying zero", () => {
    const s = summariseTape(many("up", 10));
    expect(s).not.toContain("0 degraded");
    expect(s).not.toContain("with an outage");
  });

  it("mentions paused periods", () => {
    expect(summariseTape([...many("up", 5), ...many("paused", 2)])).toContain(
      "2 paused",
    );
  });

  // It is read aloud, so it has to parse as speech rather than as a table row.
  it("reads as a sentence", () => {
    const s = summariseTape([...many("up", 88), bucket("down"), bucket("degraded")]);
    expect(s.endsWith(".")).toBe(true);
    expect(s).not.toMatch(/\d+ of \d+/);
  });
});
