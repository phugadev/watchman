"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { MonoLabel } from "@/components/ui/mono";
import type { WatchmanEvent } from "@/lib/events/bus";
import { formatMs } from "@/lib/metrics/uptime";

/**
 * The live tape — a terminal-style stream of checks and incidents as they happen.
 *
 * Fed by SSE rather than polling. A monitoring dashboard that only updates when you
 * reload is subtly untrustworthy: you cannot tell "everything is fine" from "this
 * page is stale". A visible ticker proves the probe loop is alive.
 */
export function LiveTape({
  initial,
  className,
  limit = 40,
}: {
  initial: WatchmanEvent[];
  className?: string;
  limit?: number;
}) {
  const [events, setEvents] = useState<WatchmanEvent[]>(initial);
  const [connected, setConnected] = useState(false);
  const scroller = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WatchmanEvent;
        setEvents((prev) => {
          // The stream replays recent history on connect, which overlaps whatever
          // the server already rendered. Keep only events newer than the highest
          // sequence held, so the overlap collapses instead of doubling up.
          const highest = prev.length ? Math.max(...prev.map((p) => p.seq)) : 0;
          if (event.seq <= highest) return prev;
          return [...prev, event].slice(-limit);
        });
      } catch {
        /* a malformed frame is not worth tearing the stream down for */
      }
    };

    // EventSource reconnects on its own; closing on unmount is all that is needed.
    return () => source.close();
  }, [limit]);

  // Follow the tail, but only while the reader has not scrolled up to inspect
  // something — yanking them back to the bottom mid-read would be hostile.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between px-4 py-2.5">
        <MonoLabel>live</MonoLabel>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em]",
            connected ? "text-live" : "text-slate",
          )}
        >
          <span
            className={cn(
              "size-1.5",
              connected ? "anim-pulse bg-live" : "bg-slate",
            )}
          />
          {connected ? "streaming" : "reconnecting"}
        </span>
      </div>

      <ol
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="scan min-h-0 flex-1 overflow-y-auto px-4 pb-3 font-mono text-[11px] leading-[1.7]"
      >
        {events.length === 0 ? (
          <li className="py-3 text-slate">
            <span className="anim-blink">▍</span> waiting for the next check…
          </li>
        ) : (
          events.map((event) => <TapeRow key={event.seq} event={event} />)
        )}
      </ol>
    </div>
  );
}

function TapeRow({ event }: { event: WatchmanEvent }) {
  const time = new Date(event.at).toLocaleTimeString(undefined, {
    hour12: false,
  });

  return (
    <li className="anim-rise flex items-baseline gap-2 whitespace-nowrap">
      <span className="shrink-0 tnum text-slate">{time}</span>
      <Glyph event={event} />
      <Link
        href={`/monitors/${event.monitorId}`}
        className="shrink-0 truncate text-ash hover:text-bone hover:underline"
      >
        {event.monitorName}
      </Link>
      <span className="truncate text-slate">{detail(event)}</span>
    </li>
  );
}

function Glyph({ event }: { event: WatchmanEvent }) {
  const map: Record<WatchmanEvent["type"], { char: string; tone: string }> = {
    check: { char: "·", tone: "text-slate" },
    incident_opened: { char: "▲", tone: "text-alarm" },
    incident_resolved: { char: "▼", tone: "text-live" },
    incident_acknowledged: { char: "◆", tone: "text-amp" },
    heartbeat_ping: { char: "♥", tone: "text-live" },
  };

  let { char, tone } = map[event.type];

  if (event.type === "check") {
    if (event.status === "down") ({ char, tone } = { char: "✕", tone: "text-alarm" });
    else if (event.status === "degraded")
      ({ char, tone } = { char: "~", tone: "text-warn" });
    else ({ char, tone } = { char: "✓", tone: "text-live" });
  }

  return (
    <span className={cn("w-3 shrink-0 text-center", tone)} aria-hidden>
      {char}
    </span>
  );
}

function detail(event: WatchmanEvent): string {
  switch (event.type) {
    case "check":
      if (event.error) return event.error;
      return event.latencyMs === null ? event.status : formatMs(event.latencyMs);
    case "incident_opened":
      return `incident opened — ${event.cause ?? "check failed"}`;
    case "incident_resolved":
      return `recovered after ${Math.round(event.durationMs / 1000)}s`;
    case "incident_acknowledged":
      return `acknowledged by ${event.by}`;
    case "heartbeat_ping":
      return "heartbeat received";
  }
}
