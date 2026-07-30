"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { MonoLabel } from "@/components/ui/mono";
import { StatusDot } from "@/components/ui/status";
import type { MonitorStatus } from "@/lib/metrics/uptime";

interface MonitorRef {
  id: string;
  name: string;
  kind: string;
  status: MonitorStatus;
  tags: string[];
}

interface Command {
  id: string;
  label: string;
  group: string;
  href: string;
  keywords?: string;
  status?: MonitorStatus;
}

/**
 * ⌘K palette.
 *
 * The fastest route to a specific monitor once a fleet outgrows one screen —
 * scanning a grid of forty cards for one name is slower than typing three letters
 * of it.
 */
export function CommandPalette({
  monitors,
  isAdmin,
}: {
  monitors: MonitorRef[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: "nav-dashboard", label: "Overview", group: "Go to", href: "/dashboard" },
      { id: "nav-monitors", label: "Monitors", group: "Go to", href: "/monitors" },
      { id: "nav-incidents", label: "Incidents", group: "Go to", href: "/incidents" },
      { id: "nav-channels", label: "Alert channels", group: "Go to", href: "/channels" },
      {
        id: "nav-maintenance",
        label: "Maintenance windows",
        group: "Go to",
        href: "/maintenance",
        keywords: "suppress silence deploy planned",
      },
      { id: "nav-status", label: "Status pages", group: "Go to", href: "/status-pages" },
      { id: "nav-settings", label: "Settings", group: "Go to", href: "/settings" },
      ...(isAdmin
        ? [{ id: "nav-team", label: "Team", group: "Go to", href: "/team" }]
        : []),
    ];

    const actions: Command[] = [
      {
        id: "act-new-monitor",
        label: "New monitor",
        group: "Actions",
        href: "/monitors/new",
        keywords: "create add check http heartbeat",
      },
      {
        id: "act-maintenance",
        label: "Schedule maintenance",
        group: "Actions",
        href: "/maintenance",
        keywords: "silence suppress mute deploy window planned",
      },
    ];

    const monitorCommands: Command[] = monitors.map((m) => ({
      id: `mon-${m.id}`,
      label: m.name,
      group: "Monitors",
      href: `/monitors/${m.id}`,
      // Tags join the haystack, so typing "prod" surfaces everything tagged prod.
      keywords: [m.kind, ...m.tags].join(" "),
      status: m.status,
    }));

    return [...actions, ...monitorCommands, ...nav];
  }, [monitors, isAdmin]);

  /**
   * Subsequence matching, so "apiprd" finds "API — production". Substring matching
   * would miss it, and a fuzzy-search dependency is not worth 20 lines.
   */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 12);

    const scored = commands
      .map((c) => {
        const haystack = `${c.label} ${c.keywords ?? ""}`.toLowerCase();
        const exact = haystack.indexOf(q);
        if (exact !== -1) {
          // Prefix matches rank above matches buried in the middle.
          return { c, score: exact === 0 ? 0 : 1 + exact / 100 };
        }
        let i = 0;
        for (const ch of haystack) {
          if (ch === q[i]) i++;
          if (i === q.length) break;
        }
        return i === q.length ? { c, score: 50 } : null;
      })
      .filter((x): x is { c: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score);

    return scored.slice(0, 12).map((s) => s.c);
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  const run = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      close();
      router.push(command.href);
    },
    [close, router],
  );

  // Global shortcut. Ignored while the user is typing in a form, so ⌘K inside a
  // textarea does not hijack their input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isToggle) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row in view when navigating by keyboard.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 cursor-default bg-void/80 backdrop-blur-sm"
      />

      <div className="anim-rise relative w-full max-w-lg border border-hairline bg-panel shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2.5 border-b border-hairline-soft px-4">
          <span className="font-mono text-[13px] text-slate" aria-hidden>
            &gt;
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Reset alongside the query rather than in an effect reacting to it —
              // an effect would render once with a stale cursor before correcting.
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(results.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[cursor]);
              }
            }}
            placeholder="Jump to a monitor, or type a command…"
            className="h-12 w-full bg-transparent font-mono text-[13px] text-bone placeholder:text-slate focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div ref={listRef} className="max-h-[22rem] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-slate">
              nothing matches
            </p>
          ) : (
            results.map((c, i) => {
              const showGroup = i === 0 || results[i - 1]!.group !== c.group;
              return (
                <div key={c.id}>
                  {showGroup ? (
                    <div className="px-4 pb-1 pt-2.5">
                      <MonoLabel tone="slate">{c.group}</MonoLabel>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    data-index={i}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => run(c)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-4 py-2 text-left font-mono text-[12px] transition-colors",
                      i === cursor
                        ? "bg-panel-2 text-bone"
                        : "text-ash hover:text-bone",
                    )}
                  >
                    {c.status ? (
                      <StatusDot status={c.status} />
                    ) : (
                      <span className="size-2 shrink-0 border border-hairline" aria-hidden />
                    )}
                    <span className="truncate">{c.label}</span>
                    {i === cursor ? (
                      <span className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.16em] text-slate">
                        ↵
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-hairline-soft px-4 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-slate">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
