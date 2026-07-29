import { z } from "zod";
import { MONITOR_KINDS } from "@/lib/db/schema";

/**
 * Validation for the monitor form.
 *
 * Kept free of node: and database imports so the client form and the server action
 * validate against exactly the same rules — a divergence there is how "it looked
 * fine in the UI but saved wrong" bugs happen.
 */

const trimmed = z.string().trim();

/** Headers arrive as a textarea of `Name: value` lines, not JSON. */
export function parseHeaderLines(
  input: string,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {};
  const lines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      return { ok: false, error: `Expected "Name: value" but got "${line}"` };
    }
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      return { ok: false, error: `"${name}" is not a valid header name` };
    }
    out[name] = value;
  }
  return { ok: true, value: out };
}

export function formatHeaderLines(json: string | null): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as Record<string, string>;
    return Object.entries(parsed)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  } catch {
    return "";
  }
}

export const monitorFormSchema = z
  .object({
    name: trimmed.min(1, "Name is required").max(120),
    description: trimmed.max(500).optional().or(z.literal("")),
    kind: z.enum(MONITOR_KINDS),
    target: trimmed.max(2048).optional().or(z.literal("")),

    method: z
      .enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
      .default("GET"),
    headers: z.string().max(4000).optional().or(z.literal("")),
    body: z.string().max(10_000).optional().or(z.literal("")),
    expectedStatus: trimmed.max(120).default("2xx"),
    keyword: trimmed.max(500).optional().or(z.literal("")),
    keywordMode: z.enum(["contains", "absent", "regex"]).default("contains"),
    followRedirects: z.boolean().default(true),
    verifyTls: z.boolean().default(true),

    // 10s floor: anything faster is closer to a load test than a health check,
    // and would generate 8,640 rows a day per monitor.
    intervalSec: z.coerce.number().int().min(10).max(86_400).default(60),
    timeoutMs: z.coerce.number().int().min(500).max(120_000).default(10_000),
    confirmFailures: z.coerce.number().int().min(1).max(10).default(2),
    confirmRecoveries: z.coerce.number().int().min(1).max(10).default(2),
    degradedMs: z.coerce.number().int().min(0).max(120_000).nullable().default(null),

    graceSec: z.coerce.number().int().min(0).max(86_400).default(120),
    sslWarnDays: z.coerce.number().int().min(1).max(365).default(21),
    sloTargetPct: z.coerce.number().min(50).max(100).default(99.9),

    paused: z.boolean().default(false),
    channelIds: z.array(z.string()).default([]),
  })
  .superRefine((data, ctx) => {
    // Target requirements differ per kind, which a flat schema cannot express.
    const requireTarget = (message: string) => {
      if (!data.target) {
        ctx.addIssue({ code: "custom", path: ["target"], message });
        return false;
      }
      return true;
    };

    switch (data.kind) {
      case "http": {
        if (!requireTarget("A URL is required")) break;
        let url: URL;
        try {
          url = new URL(data.target!);
        } catch {
          ctx.addIssue({
            code: "custom",
            path: ["target"],
            message: "Enter a full URL including https://",
          });
          break;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          ctx.addIssue({
            code: "custom",
            path: ["target"],
            message: "Only http:// and https:// URLs can be monitored",
          });
        }
        break;
      }

      case "tcp": {
        if (!requireTarget("A host:port is required")) break;
        if (!/:\d+$/.test(data.target!)) {
          ctx.addIssue({
            code: "custom",
            path: ["target"],
            message: "Include a port, e.g. db.internal:5432",
          });
        }
        break;
      }

      case "ping":
      case "ssl":
        requireTarget("A hostname is required");
        break;

      case "heartbeat":
        // Nothing to reach — the job calls us.
        break;
    }

    if (data.keyword && data.keywordMode === "regex") {
      try {
        new RegExp(data.keyword);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["keyword"],
          message: "That is not a valid regular expression",
        });
      }
    }

    // A degraded threshold above the timeout can never fire — the check would
    // fail first — so it is silently useless rather than wrong.
    if (data.degradedMs && data.degradedMs >= data.timeoutMs) {
      ctx.addIssue({
        code: "custom",
        path: ["degradedMs"],
        message: "Must be below the timeout, or it can never trigger",
      });
    }
  });

export type MonitorFormInput = z.input<typeof monitorFormSchema>;
export type MonitorFormValues = z.output<typeof monitorFormSchema>;

/** Sensible interval per kind, applied when the form switches type. */
export const DEFAULT_INTERVAL: Record<(typeof MONITOR_KINDS)[number], number> = {
  http: 60,
  tcp: 60,
  ping: 60,
  // Certificates change on the scale of months; polling one every minute is waste.
  ssl: 21_600,
  // For a heartbeat, the interval is the job's own schedule.
  heartbeat: 3_600,
};

export const TARGET_PLACEHOLDER: Record<
  (typeof MONITOR_KINDS)[number],
  string
> = {
  http: "https://api.example.com/health",
  tcp: "db.internal:5432",
  ping: "192.168.1.1",
  ssl: "example.com",
  heartbeat: "",
};

export const TARGET_LABEL: Record<(typeof MONITOR_KINDS)[number], string> = {
  http: "URL",
  tcp: "Host and port",
  ping: "Hostname or IP",
  ssl: "Hostname",
  heartbeat: "Ping URL",
};
