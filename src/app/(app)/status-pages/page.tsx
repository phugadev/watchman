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
  await requireUser();
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
        <StatusPageForm monitors={monitorOptions} />
      </SectionHeader>

      {pages.length === 0 ? (
        <EmptyState
          title="no status pages"
          hint="A status page publishes a chosen subset of monitors — with 90 days of uptime history — at a public URL, so you can point users at it instead of answering the same question repeatedly."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
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
                            ? "size-2 shrink-0 bg-live"
                            : "size-2 shrink-0 bg-slate"
                        }
                        aria-hidden
                      />
                      <span className="truncate text-[14px] font-medium text-bone">
                        {page.title}
                      </span>
                    </div>
                    <MonoLabel tone="slate">
                      {page.published ? "published" : "draft"} · {itemCount} monitor
                      {itemCount === 1 ? "" : "s"}
                    </MonoLabel>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <form action={togglePublishedAction}>
                      <input type="hidden" name="id" value={page.id} />
                      <Button type="submit" variant="bracket" size="sm">
                        {page.published ? "unpublish" : "publish"}
                      </Button>
                    </form>
                    <form action={deleteStatusPageAction}>
                      <input type="hidden" name="id" value={page.id} />
                      <Button
                        type="submit"
                        variant="bracket"
                        size="sm"
                        className="hover:text-alarm"
                      >
                        delete
                      </Button>
                    </form>
                  </div>
                </div>

                <Rule />

                <div className="flex flex-col">
                  <KeyValue k="url">
                    <Link
                      href={`/status/${page.slug}`}
                      target="_blank"
                      className="hover:text-amp"
                    >
                      /status/{page.slug}
                    </Link>
                  </KeyValue>
                  <KeyValue k="grades">{page.showGrades ? "shown" : "hidden"}</KeyValue>
                  <KeyValue k="latency">{page.showLatency ? "shown" : "hidden"}</KeyValue>
                  <KeyValue k="history">{page.historyDays} days</KeyValue>
                </div>

                {page.description ? (
                  <p className="text-[12px] leading-relaxed text-ash">
                    {page.description}
                  </p>
                ) : null}

                {!page.published ? (
                  <p className="text-[11px] leading-relaxed text-slate">
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

                <Rule />
                <StatusPageForm
                  monitors={monitorOptions}
                  page={page}
                  selectedMonitorIds={selected}
                />
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
