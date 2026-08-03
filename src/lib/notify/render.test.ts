import { describe, expect, it } from "vitest";
import {
  alertFields,
  renderDiscord,
  renderEmailHtml,
  renderSlack,
  renderSubject,
  renderText,
} from "./render";
import type { AlertPayload } from "./types";

function payload(over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    version: 1,
    event: "monitor.down",
    timestamp: "2026-08-03T10:00:00.000Z",
    monitor: {
      id: "m1",
      name: "Payments API",
      kind: "http",
      target: "https://api.example.com/health",
      url: "https://watch.example.com/monitors/m1",
    },
    check: {
      status: "down",
      latencyMs: 1234,
      httpStatus: 503,
      error: "HTTP 503 Service Unavailable",
    },
    health: { grade: "B", uptime24hPct: 98.7654, p95Ms: 410 },
    ...over,
  };
}

describe("alertFields", () => {
  it("prefers the failing check's error over the incident cause", () => {
    const fields = alertFields(
      payload({
        check: { status: "down", error: "Connection refused" },
        incident: {
          id: "i1",
          startedAt: "2026-08-03T09:00:00.000Z",
          cause: "an older cause",
          url: "https://watch.example.com/incidents/i1",
        },
      }),
    );

    expect(fields.find((f) => f.label === "Cause")?.value).toBe(
      "Connection refused",
    );
  });

  it("falls back to the incident cause on a recovery, where there is no failing check", () => {
    const fields = alertFields(
      payload({
        event: "monitor.up",
        check: { status: "up", latencyMs: 120, error: null },
        incident: {
          id: "i1",
          startedAt: "2026-08-03T09:00:00.000Z",
          resolvedAt: "2026-08-03T09:10:00.000Z",
          durationMs: 600_000,
          cause: "Connection refused",
          url: "https://watch.example.com/incidents/i1",
        },
      }),
    );

    expect(fields.find((f) => f.label === "Cause")?.value).toBe(
      "Connection refused",
    );
    expect(fields.find((f) => f.label === "Downtime")?.value).toBe("10m");
  });

  it("omits fields that have no value rather than printing a dash", () => {
    const labels = alertFields(
      payload({ check: undefined, health: undefined }),
    ).map((f) => f.label);

    expect(labels).toEqual(["Target"]);
  });

  it("uses the kind as the target for heartbeats, which have none", () => {
    const fields = alertFields(
      payload({
        monitor: {
          id: "m2",
          name: "Nightly backup",
          kind: "heartbeat",
          target: "",
          url: "https://watch.example.com/monitors/m2",
        },
      }),
    );

    expect(fields.find((f) => f.label === "Target")?.value).toBe("heartbeat");
  });
});

describe("renderSlack", () => {
  it("carries a fallback text, which is what a phone push shows", () => {
    expect(renderSlack(payload()).text).toBe("DOWN: Payments API");
  });

  it("escapes mrkdwn control characters in operator-supplied text", () => {
    const msg = renderSlack(
      payload({
        monitor: {
          id: "m1",
          name: "<script>alert(1)</script> & co",
          kind: "http",
          target: "https://api.example.com",
          url: "https://watch.example.com/monitors/m1",
        },
      }),
    );

    const header = JSON.stringify(msg.blocks[0]);
    expect(header).not.toContain("<script>");
    expect(header).toContain("&lt;script&gt;");
    expect(header).toContain("&amp;");
  });

  it("stays within Slack's ten-field limit for a section", () => {
    for (const block of renderSlack(payload()).blocks) {
      expect(block.fields?.length ?? 0).toBeLessThanOrEqual(10);
    }
  });

  it("ends with the deep link, so it survives truncation", () => {
    const blocks = renderSlack(payload()).blocks;
    expect(JSON.stringify(blocks.at(-1))).toContain(
      "https://watch.example.com/monitors/m1",
    );
  });
});

describe("renderDiscord", () => {
  it("converts the accent to the decimal integer Discord expects", () => {
    // #e5484d — a hex string here renders as a black stripe.
    expect(renderDiscord(payload()).embeds[0]!.color).toBe(0xe5484d);
    expect(renderDiscord(payload({ event: "monitor.up" })).embeds[0]!.color).toBe(
      0x30a46c,
    );
  });

  it("lays the cause full width and everything else two-up", () => {
    const fields = renderDiscord(payload()).embeds[0]!.fields;
    expect(fields.find((f) => f.name === "Cause")?.inline).toBe(false);
    expect(fields.find((f) => f.name === "Target")?.inline).toBe(true);
  });

  it("clamps a field value to Discord's 1024-character limit", () => {
    const long = "x".repeat(5000);
    const fields = renderDiscord(
      payload({ check: { status: "down", error: long } }),
    ).embeds[0]!.fields;

    expect(fields.find((f) => f.name === "Cause")!.value.length).toBe(1024);
  });

  it("notes flapping in the footer rather than dropping it", () => {
    const embed = renderDiscord(
      payload({
        incident: {
          id: "i1",
          startedAt: "2026-08-03T09:00:00.000Z",
          flapping: true,
          url: "https://watch.example.com/incidents/i1",
        },
      }),
    ).embeds[0]!;

    expect(embed.footer?.text).toContain("Flapping");
  });
});

describe("renderEmailHtml", () => {
  it("escapes HTML in operator-supplied values", () => {
    const html = renderEmailHtml(
      payload({
        check: {
          status: "down",
          error: "<img src=x onerror=alert(1)>",
        },
      }),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("links to the incident when there is one, and the monitor otherwise", () => {
    expect(renderEmailHtml(payload())).toContain(
      'href="https://watch.example.com/monitors/m1"',
    );
    expect(
      renderEmailHtml(
        payload({
          incident: {
            id: "i1",
            startedAt: "2026-08-03T09:00:00.000Z",
            url: "https://watch.example.com/incidents/i1",
          },
        }),
      ),
    ).toContain('href="https://watch.example.com/incidents/i1"');
  });
});

describe("renderText", () => {
  it("strips markup and unescapes entities, so the plain part reads as prose", () => {
    const text = renderText(
      payload({
        monitor: {
          id: "m1",
          name: "a & b",
          kind: "http",
          target: "https://api.example.com",
          url: "https://watch.example.com/monitors/m1",
        },
      }),
    );

    expect(text).not.toContain("<b>");
    expect(text).toContain("a & b");
    expect(text).not.toContain("&amp;");
  });

  it("keeps the link's URL, since stripping the anchor would leave nothing to open", () => {
    const text = renderText(payload());
    expect(text).toContain(
      "Open in Watchman: https://watch.example.com/monitors/m1",
    );
  });
});

describe("renderSubject", () => {
  it("leads with the state, which is the part read in a notification list", () => {
    expect(renderSubject(payload())).toBe("DOWN: Payments API");
    expect(renderSubject(payload({ event: "monitor.up" }))).toBe(
      "RECOVERED: Payments API",
    );
    expect(renderSubject(payload({ event: "test" }))).toBe(
      "Watchman test alert — Payments API",
    );
  });
});
