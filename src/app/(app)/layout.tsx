import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/lib/auth/actions";
import { countOpenIncidents } from "@/lib/queries";
import { recentEvents } from "@/lib/events/bus";
import { Mark } from "@/components/ui/logo";
import { MonoLabel } from "@/components/ui/mono";
import { NavLinks } from "@/components/shell/nav";
import { LiveTape } from "@/components/shell/live-tape";
import { CommandPalette } from "@/components/shell/command-palette";
import { listMonitorsWithHealth } from "@/lib/queries";

/**
 * Every page under this layout depends on live database state, so none may be
 * prerendered. Declared once here rather than per page, because forgetting it is silent
 * and the failure is nasty: at build time no account exists, so `requireUser()` takes
 * its needs-setup branch and redirects *before* reading cookies. With no dynamic API
 * touched, Next marks the route static and bakes that redirect in permanently — which
 * is exactly what had happened to /monitors/new.
 */
export const dynamic = "force-dynamic";

/**
 * The signed-in shell.
 *
 * A fixed header and a persistent right-hand live tape on wide screens. The tape is
 * always visible on purpose: it is the proof that the probe loop is running, which
 * a static dashboard cannot give you.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const openIncidents = countOpenIncidents();
  const monitors = listMonitorsWithHealth(0);

  const nav = [
    { href: "/dashboard", label: "Overview" },
    { href: "/monitors", label: "Monitors" },
    { href: "/incidents", label: "Incidents", badge: openIncidents },
    { href: "/channels", label: "Alerts" },
    { href: "/maintenance", label: "Maintenance" },
    { href: "/status-pages", label: "Status" },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <CommandPalette
        monitors={monitors.map((m) => ({
          id: m.monitor.id,
          name: m.monitor.name,
          kind: m.monitor.kind,
          status: m.status,
        }))}
        isAdmin={user.role === "admin"}
      />

      <header className="sticky top-0 z-40 border-b border-hairline-soft bg-void/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[110rem] items-center gap-6 px-5">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="Watchman home"
          >
            <Mark size={20} className="text-bone" />
            <span className="hidden font-sans text-[14px] font-semibold tracking-tight text-bone sm:inline">
              Watchman
            </span>
          </Link>

          <NavLinks items={nav} className="min-w-0 flex-1 overflow-x-auto" />

          <div className="flex shrink-0 items-center gap-4">
            {/* Discoverability for the palette — a shortcut nobody knows about is
                a shortcut nobody uses. */}
            <span className="hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-slate lg:flex">
              <kbd className="border border-hairline-soft px-1.5 py-0.5 text-[9px]">⌘K</kbd>
              search
            </span>

            <Link
              href="/settings"
              className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-slate transition-colors hover:text-ash sm:inline"
            >
              {user.name.split(" ")[0]}
            </Link>

            <form action={logoutAction}>
              <button
                type="submit"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate transition-colors hover:text-alarm"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[110rem] flex-1 gap-0 px-0">
        <main className="min-w-0 flex-1 px-5 py-8">{children}</main>

        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[19rem] shrink-0 border-l border-hairline-soft xl:block">
          <LiveTape initial={recentEvents(30)} className="h-full" />
        </aside>
      </div>

      <footer className="border-t border-hairline-soft px-5 py-4">
        <div className="mx-auto flex max-w-[110rem] items-center justify-between gap-4">
          <MonoLabel tone="slate">watchman · self-hosted</MonoLabel>
          <a
            href="/api/health"
            className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate transition-colors hover:text-ash"
          >
            health
          </a>
        </div>
      </footer>
    </div>
  );
}
