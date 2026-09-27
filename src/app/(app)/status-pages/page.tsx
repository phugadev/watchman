import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { Code, KeyValue, MonoLabel } from "@/components/ui/mono";
import { StatusPageForm } from "@/components/status/status-page-form";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import {
  deleteStatusPageAction,
  togglePublishedAction,
} from "@/lib/status-pages/actions";
import { listMonitorsWithHealth, listStatusPages } from "@/lib/queries";
import { db } from "@/lib/db";
import { statusPageItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Status pages" };
export const dynamic = "force-dynamic";

export default async function StatusPagesPage() {
  // Publishing a status page exposes service names and availability to the open
  // internet, so composition is an admin decision.
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const pages = listStatusPages();
  const monitors = listMonitorsWithHealth(0);

  const monitorOptions = monitors.map((m) => ({
    id: m.monitor.id,
    name: m.monitor.name,
    kind: m.monitor.kind,
  }));

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader label="status pages">
        {isAdmin ? (
          <StatusPageForm monitors={monitorOptions} />
        ) : (
          <MonoLabel tone="slate">read only</MonoLabel>
        )}
      </SectionHeader>

      {pages.length === 0 ? (
        <EmptyState
          title="no status pages"
          hint="A status page publishes a chosen subset of monitors — with 90 days of uptime history — at a public URL, so you can point users at it instead of answering the same question repeatedly."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {pages.map(({ page, itemCount }) => {
            const selected = db
              .select({ monitorId: statusPageItems.monitorId })
              .from(statusPageItems)
              .where(eq(statusPageItems.pageId, page.id))
              .all()
              .map((r) => r.monitorId);

            return (
              <Panel key={page.id} inset className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={
                          page.published
                            ? "size-2 shrink-0 bg-green-mark"
                            : "size-2 shrink-0 bg-gray-solid"
                        }
                        aria-hidden
                      />
                      <span className="truncate type-body font-medium text-foreground">
                        {page.title}
                      </span>
                    </div>
                    <MonoLabel tone="slate">
                      {page.published ? "published" : "draft"} · {itemCount} monitor
                      {itemCount === 1 ? "" : "s"}
                    </MonoLabel>
                  </div>

                  {isAdmin ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <form action={togglePublishedAction}>
                        <input type="hidden" name="id" value={page.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          {page.published ? "unpublish" : "publish"}
                        </Button>
                      </form>
                      <form action={deleteStatusPageAction}>
                        <input type="hidden" name="id" value={page.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="hover:text-red-text"
                        >
                          delete
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </div>

                <Rule />

                <div className="flex flex-col">
                  <KeyValue k="url">
                    <Link
                      href={`/status/${page.slug}`}
                      target="_blank"
                      className="hover:text-foreground"
                    >
                      /status/{page.slug}
                    </Link>
                  </KeyValue>
                  <KeyValue k="grades">{page.showGrades ? "shown" : "hidden"}</KeyValue>
                  <KeyValue k="latency">{page.showLatency ? "shown" : "hidden"}</KeyValue>
                  <KeyValue k="history">{page.historyDays} days</KeyValue>
                </div>

                {page.description ? (
                  <p className="type-caption-sm text-muted-foreground">
                    {page.description}
                  </p>
                ) : null}

                {!page.published ? (
                  <p className="type-caption-sm text-subtle-foreground">
                    Drafts return 404 to the public but stay viewable while you are
                    signed in, so you can check it before announcing the link.
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <MonoLabel tone="slate">share</MonoLabel>
                    <Code className="truncate">
                      {env.publicUrl}/status/{page.slug}
                    </Code>
                  </div>
                )}

                {isAdmin ? (
                  <>
                    <Rule />
                    <StatusPageForm
                      monitors={monitorOptions}
                      page={page}
                      selectedMonitorIds={selected}
                    />
                  </>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
