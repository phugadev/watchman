import { EventEmitter } from "node:events";

/**
 * In-process pub/sub feeding the live event tape over SSE.
 *
 * Process-local by design: Watchman runs as one container, so the scheduler that
 * produces events and the request handlers that stream them share a heap. No
 * broker, no polling — a check completes and connected dashboards see it within a
 * few milliseconds.
 */

export type WatchmanEvent =
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

export type WatchmanEventType = WatchmanEvent["type"];

// Cached on globalThis so dev HMR does not orphan subscribers on a fresh emitter.
const globalForBus = globalThis as unknown as {
  __watchmanBus?: EventEmitter;
  __watchmanRecent?: WatchmanEvent[];
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

export function publish(event: WatchmanEvent): void {
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
