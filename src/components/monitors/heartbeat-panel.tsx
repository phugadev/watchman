"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import { rotateHeartbeatTokenAction } from "@/lib/monitors/actions";

/**
 * The heartbeat setup panel.
 *
 * Ready-to-paste snippets rather than a URL and a paragraph of prose. The `-fsS -m
 * 10` flags matter and most people would not add them: fail silently on error, but
 * still report the failure, and never let a hung Watchman hold a cron job open.
 * Getting that wrong is how a monitoring call ends up breaking the job it watches.
 */
export function HeartbeatPanel({
  monitorId,
  token,
  publicUrl,
  intervalSec,
  graceSec,
  canRotate = false,
}: {
  monitorId: string;
  token: string;
  publicUrl: string;
  intervalSec: number;
  graceSec: number;
  /** Rotating breaks a URL already deployed in someone's crontab — admins only. */
  canRotate?: boolean;
}) {
  const url = `${publicUrl}/api/ping/${token}`;
  const [copied, setCopied] = useState<string | null>(null);

  const snippets: { label: string; hint: string; code: string }[] = [
    {
      label: "crontab",
      hint: "Pings only if the job exits 0, so a failed backup still alerts.",
      code: `0 3 * * * /opt/backup.sh && curl -fsS -m 10 ${url}`,
    },
    {
      label: "shell — report either outcome",
      hint: "Tells Watchman about failures too, with the exit code as the reason.",
      code: `/opt/backup.sh \\
  && curl -fsS -m 10 ${url} \\
  || curl -fsS -m 10 "${url}?status=fail&msg=exit_$?"`,
    },
    {
      label: "node",
      hint: "",
      code: `await fetch("${url}", { method: "POST" });`,
    },
    {
      label: "python",
      hint: "",
      code: `import urllib.request\nurllib.request.urlopen("${url}", timeout=10)`,
    },
  ];

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard is unavailable over plain HTTP on some browsers; the text is
      // selectable either way.
    }
  };

  return (
    <Panel inset className="flex flex-col gap-5">
      <SectionHeader label="heartbeat url">
        {canRotate ? (
          <form action={rotateHeartbeatTokenAction}>
            <input type="hidden" name="id" value={monitorId} />
            <Button type="submit" variant="ghost" size="sm">
              rotate
            </Button>
          </form>
        ) : null}
      </SectionHeader>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-control-md border border-border bg-background px-3 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono type-caption-sm text-foreground">
            {url}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copy(url, "url")}
          >
            {copied === "url" ? "copied" : "copy"}
          </Button>
        </div>
        <p className="type-caption-sm text-subtle-foreground">
          Watchman expects a call every <strong className="text-muted-foreground">{intervalSec}s</strong>,
          and alerts once it is{" "}
          <strong className="text-muted-foreground">{graceSec}s</strong> late. Anyone holding this
          URL can mark the job alive or failed — it grants nothing else, but treat it
          as a secret and rotate it if it leaks.
        </p>
      </div>

      <Rule />

      <div className="flex flex-col gap-4">
        {snippets.map((s) => (
          <div key={s.label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <MonoLabel>{s.label}</MonoLabel>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copy(s.code, s.label)}
              >
                {copied === s.label ? "copied" : "copy"}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-control-md border border-border bg-muted px-3 py-2.5 font-mono type-caption-sm text-foreground">
              {s.code}
            </pre>
            {s.hint ? (
              <p className="type-caption-sm text-subtle-foreground">{s.hint}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
