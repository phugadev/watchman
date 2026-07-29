import { EventEmitter } from "node:events";

/**
 * In-process pub/sub feeding the live event tape over SSE.
 *
 * Process-local by design: Watchman runs as one container, so the scheduler that
 * produces events and the request handlers that stream them share a heap. No
 * broker, no polling — a check completes and connected dashboards see it within a
 * few milliseconds.
 */

/**
 * The event variants, before the bus stamps a sequence number on them.
 *
 * Declared as a standalone union and intersected below rather than written inline as
 * `Seq & (A | B)` — SWC's TypeScript parser rejects a parenthesised union inside an
 * intersection, so that form typechecks under tsc but fails the Turbopack build.
 */
type WatchmanEventBody =
  | {
      type: "check";
      at: number;
      monitorId: string;
      monitorName: string;
      status: "up" | "degraded" | "down";
      latencyMs: number | null;
      error: string | null;
      /** True when this check changed the monitor's status. */
      changed: boolean;
    }
  | {
      type: "incident_opened";
      at: number;
      monitorId: string;
      monitorName: string;
      incidentId: string;
      cause: string | null;
    }
  | {
      type: "incident_resolved";
      at: number;
      monitorId: string;
      monitorName: string;
      incidentId: string;
      durationMs: number;
    }
  | {
      type: "incident_acknowledged";
      at: number;
      monitorId: string;
      monitorName: string;
      incidentId: string;
      by: string;
    }
  | {
      type: "heartbeat_ping";
      at: number;
      monitorId: string;
      monitorName: string;
    };

/**
 * A monotonic sequence number, stamped by the bus.
 *
 * Both the server-rendered tape and the SSE replay buffer emit recent history, so
 * without an identity the client renders each event twice. `seq` lets it keep only
 * what it has not seen, and covers the reverse gap too: events published between the
 * server render and the moment the stream actually connects.
 */
export type WatchmanEvent = WatchmanEventBody & { seq: number };

/** What callers pass to `publish` — the bus owns `seq`. */
export type WatchmanEventInput = WatchmanEventBody;

export type WatchmanEventType = WatchmanEvent["type"];

// Cached on globalThis so dev HMR does not orphan subscribers on a fresh emitter.
const globalForBus = globalThis as unknown as {
  __watchmanBus?: EventEmitter;
  __watchmanRecent?: WatchmanEvent[];
  __watchmanSeq?: { n: number };
};

const emitter =
  globalForBus.__watchmanBus ??
  (() => {
    const e = new EventEmitter();
    // One listener per connected SSE client; the default cap of 10 would warn on
    // a handful of open dashboard tabs.
    e.setMaxListeners(0);
    return e;
  })();

globalForBus.__watchmanBus = emitter;

/**
 * A short replay buffer. A dashboard that has just loaded would otherwise show an
 * empty tape until the next check fires, which on a 5-minute interval is a long
 * time to look at nothing.
 */
const RECENT_LIMIT = 60;
const recent: WatchmanEvent[] = (globalForBus.__watchmanRecent ??= []);
const counter = (globalForBus.__watchmanSeq ??= { n: 0 });

export function publish(input: WatchmanEventInput): void {
  const event = { ...input, seq: ++counter.n } as WatchmanEvent;
  recent.push(event);
  if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
  emitter.emit("event", event);
}

export function subscribe(handler: (event: WatchmanEvent) => void): () => void {
  emitter.on("event", handler);
  return () => emitter.off("event", handler);
}

/** Newest last, matching the order the tape renders in. */
export function recentEvents(limit = RECENT_LIMIT): WatchmanEvent[] {
  return recent.slice(-limit);
}
