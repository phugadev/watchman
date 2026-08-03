"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import {
  createMonitorAction,
  updateMonitorAction,
  type MonitorActionState,
} from "@/lib/monitors/actions";
import {
  DEFAULT_INTERVAL,
  TARGET_LABEL,
  TARGET_PLACEHOLDER,
  formatHeaderLines,
} from "@/lib/monitors/schema";
import { formatTags } from "@/lib/monitors/tags";
import {
  DNS_RECORD_TYPES,
  MONITOR_KINDS,
  type Monitor,
  type MonitorKind,
} from "@/lib/db/schema";

const KIND_LABEL: Record<MonitorKind, string> = {
  http: "HTTP / HTTPS",
  tcp: "TCP port",
  ping: "Ping (ICMP)",
  ssl: "TLS certificate",
  dns: "DNS record",
  heartbeat: "Heartbeat (dead man's switch)",
};

const KIND_HINT: Record<MonitorKind, string> = {
  http: "Request a URL and assert on the status code, the body, and the response time.",
  tcp: "Open a TCP connection. The right check for anything that isn't HTTP — a database, a queue, an SMTP relay.",
  ping: "ICMP echo. Proves the host is reachable, but says nothing about whether the application works.",
  ssl: "Watch a certificate's expiry and trust chain, so renewal never becomes an outage.",
  dns: "Resolve a name and assert on the answer. Catches a zone breaking, a record being dropped by a migration, or one changing under you.",
  heartbeat:
    "Watchman waits for your job to call in. Alerts when a cron, worker, or backup stops running — the failure no outside probe can see.",
};

const initial: MonitorActionState = {};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" disabled={pending} className="relative overflow-hidden">
      {pending ? "Saving…" : label}
      {pending ? <span className="anim-sweep absolute inset-x-0 bottom-0 h-0.5" /> : null}
    </Button>
  );
}

/**
 * The monitor form.
 *
 * Fields appear and disappear with the selected kind rather than being greyed out:
 * a heartbeat has no URL, no method, and no keyword, and showing eleven inert
 * inputs makes the form look far more complicated than the task is.
 */
export function MonitorForm({
  monitor,
  channels,
  attachedChannelIds = [],
}: {
  monitor?: Monitor;
  channels: { id: string; name: string; kind: string }[];
  attachedChannelIds?: string[];
}) {
  const editing = Boolean(monitor);
  const [state, action] = useActionState(
    editing ? updateMonitorAction : createMonitorAction,
    initial,
  );

  const [kind, setKind] = useState<MonitorKind>(monitor?.kind ?? "http");
  const [interval, setInterval] = useState(
    String(monitor?.intervalSec ?? DEFAULT_INTERVAL.http),
  );
  const [keywordMode, setKeywordMode] = useState(monitor?.keywordMode ?? "contains");
  const [dnsMatchMode, setDnsMatchMode] = useState(
    monitor?.dnsMatchMode ?? "contains",
  );

  const err = (field: string) => state.fieldErrors?.[field] ?? null;
  const isHttp = kind === "http";
  const isHeartbeat = kind === "heartbeat";
  const usesNetwork = !isHeartbeat;

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-8">
      {editing ? <input type="hidden" name="id" value={monitor!.id} /> : null}
      <FormError>{state.error}</FormError>

      {/* ---- identity --------------------------------------------------- */}
      <Panel inset className="flex flex-col gap-5">
        <SectionHeader label="what to watch" />
        <Rule />

        <Field label="Name" htmlFor="name" required error={err("name")}>
          <Input
            id="name"
            name="name"
            defaultValue={monitor?.name}
            placeholder="API — production"
            required
            autoFocus={!editing}
            maxLength={120}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="description"
          hint="Optional. Shows on the monitor page and in incident context."
        >
          <Input
            id="description"
            name="description"
            defaultValue={monitor?.description ?? ""}
            placeholder="Core REST API health endpoint"
            maxLength={500}
          />
        </Field>

        <Field
          label="Tags"
          htmlFor="tags"
          hint="Comma separated. Used to filter the monitor list — env:prod, team:payments, tier:1."
          error={err("tags")}
        >
          <Input
            id="tags"
            name="tags"
            defaultValue={formatTags(monitor?.tags ?? null)}
            placeholder="prod, api, tier:1"
            maxLength={400}
            spellCheck={false}
          />
        </Field>

        <Field label="Type" htmlFor="kind" hint={KIND_HINT[kind]}>
          <Select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => {
              const next = e.target.value as MonitorKind;
              setKind(next);
              // Only re-suggest an interval when creating; overwriting a deliberate
              // choice on an existing monitor would be presumptuous.
              if (!editing) setInterval(String(DEFAULT_INTERVAL[next]));
            }}
          >
            {MONITOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>

        {usesNetwork ? (
          <Field
            label={TARGET_LABEL[kind]}
            htmlFor="target"
            required
            error={err("target")}
          >
            <Input
              id="target"
              name="target"
              defaultValue={monitor?.target}
              placeholder={TARGET_PLACEHOLDER[kind]}
              required
              spellCheck={false}
            />
          </Field>
        ) : (
          <div className="border border-dashed border-hairline-soft bg-void/50 px-4 py-3">
            <MonoLabel tone="amp">no target needed</MonoLabel>
            <p className="mt-2 text-[12px] leading-relaxed text-ash">
              {editing
                ? "The ping URL is on the monitor page — paste it into your cron job or worker."
                : "Watchman will generate a unique ping URL when you save. Add it to the end of your job and it will alert if the job stops calling in."}
            </p>
          </div>
        )}
      </Panel>

      {/* ---- HTTP specifics --------------------------------------------- */}
      {isHttp ? (
        <Panel inset className="flex flex-col gap-5">
          <SectionHeader label="request &amp; assertions" />
          <Rule />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Method" htmlFor="method">
              <Select id="method" name="method" defaultValue={monitor?.method ?? "GET"}>
                {["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Accepted status"
              htmlFor="expectedStatus"
              hint="Exact codes, wildcards, or ranges: 200 · 2xx · 200,204 · 200-299"
              error={err("expectedStatus")}
            >
              <Input
                id="expectedStatus"
                name="expectedStatus"
                defaultValue={monitor?.expectedStatus ?? "2xx"}
                placeholder="2xx"
              />
            </Field>
          </div>

          <Field
            label="Request headers"
            htmlFor="headers"
            hint="One per line, as Name: value. Useful for auth tokens and host overrides."
            error={err("headers")}
          >
            <Textarea
              id="headers"
              name="headers"
              rows={3}
              defaultValue={formatHeaderLines(monitor?.headers ?? null)}
              placeholder={"Authorization: Bearer …\nX-Health-Check: watchman"}
              spellCheck={false}
            />
          </Field>

          <Field
            label="Request body"
            htmlFor="body"
            hint="Sent with POST, PUT, and PATCH."
          >
            <Textarea
              id="body"
              name="body"
              rows={2}
              defaultValue={monitor?.body ?? ""}
              placeholder='{"probe":true}'
              spellCheck={false}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
            <Field
              label="Body assertion"
              htmlFor="keyword"
              hint={
                keywordMode === "absent"
                  ? "Fails if the text IS present. The best signal for a broken deploy that still returns 200 with an error page."
                  : keywordMode === "regex"
                    ? "Case-insensitive regular expression matched against the body."
                    : "Fails if the text is missing from the response body."
              }
              error={err("keyword")}
            >
              <Input
                id="keyword"
                name="keyword"
                defaultValue={monitor?.keyword ?? ""}
                placeholder={keywordMode === "absent" ? "Application Error" : '"status":"ok"'}
                spellCheck={false}
              />
            </Field>

            <Field label="Mode" htmlFor="keywordMode">
              <Select
                id="keywordMode"
                name="keywordMode"
                value={keywordMode}
                onChange={(e) =>
                  setKeywordMode(e.target.value as typeof keywordMode)
                }
              >
                <option value="contains">must contain</option>
                <option value="absent">must not contain</option>
                <option value="regex">regex</option>
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-4 pt-1">
            <Switch
              name="followRedirects"
              label="Follow redirects"
              hint="Up to 5 hops. Latency is the sum of the whole chain, matching what a user waits for."
              defaultChecked={monitor?.followRedirects ?? true}
            />
            <Switch
              name="verifyTls"
              label="Verify TLS certificate"
              hint="Turn off only for a host whose certificate you know is invalid, such as an internal box with a self-signed cert."
              defaultChecked={monitor?.verifyTls ?? true}
            />
          </div>
        </Panel>
      ) : null}

      {/* ---- DNS specifics ----------------------------------------------- */}
      {kind === "dns" ? (
        <Panel inset className="flex flex-col gap-5">
          <SectionHeader label="record &amp; assertions" />
          <Rule />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Record type" htmlFor="dnsRecordType">
              <Select
                id="dnsRecordType"
                name="dnsRecordType"
                defaultValue={monitor?.dnsRecordType ?? "A"}
              >
                {DNS_RECORD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Resolver"
              htmlFor="dnsResolver"
              hint="Blank uses the system resolver. Point one monitor at your authoritative server and another at 1.1.1.1 to watch propagation."
              error={err("dnsResolver")}
            >
              <Input
                id="dnsResolver"
                name="dnsResolver"
                defaultValue={monitor?.dnsResolver ?? ""}
                placeholder="1.1.1.1"
                spellCheck={false}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
            <Field
              label="Expected answer"
              htmlFor="dnsExpected"
              hint={
                dnsMatchMode === "exact"
                  ? "The complete answer. Any record you did not list is a failure — which is how you catch one appearing that should not exist."
                  : "One per line. Blank asserts only that the name resolves at all."
              }
              error={err("dnsExpected")}
            >
              <Textarea
                id="dnsExpected"
                name="dnsExpected"
                rows={3}
                defaultValue={monitor?.dnsExpected ?? ""}
                placeholder={"93.184.216.34\n93.184.216.35"}
                spellCheck={false}
              />
            </Field>

            <Field label="Match" htmlFor="dnsMatchMode">
              <Select
                id="dnsMatchMode"
                name="dnsMatchMode"
                value={dnsMatchMode}
                onChange={(e) =>
                  setDnsMatchMode(e.target.value as typeof dnsMatchMode)
                }
              >
                <option value="contains">must include</option>
                <option value="exact">exactly</option>
              </Select>
            </Field>
          </div>

          <p className="text-[12px] leading-relaxed text-ash">
            MX and SRV answers are compared in zone-file order —{" "}
            <code className="font-mono text-bone">10 mail.example.com</code>. TXT
            records are joined back together first, so a DKIM key split across
            chunks matches the value you published.
          </p>
        </Panel>
      ) : null}

      {/* ---- timing ----------------------------------------------------- */}
      <Panel inset className="flex flex-col gap-5">
        <SectionHeader label="timing &amp; sensitivity" />
        <Rule />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={isHeartbeat ? "Expected every (seconds)" : "Check interval (seconds)"}
            htmlFor="intervalSec"
            hint={
              isHeartbeat
                ? "How often the job should call in. Match your cron schedule."
                : "How often to probe. 60s suits most services."
            }
            error={err("intervalSec")}
          >
            <Input
              id="intervalSec"
              name="intervalSec"
              type="number"
              min={10}
              max={86400}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              required
            />
          </Field>

          {isHeartbeat ? (
            <Field
              label="Grace period (seconds)"
              htmlFor="graceSec"
              hint="Extra lateness tolerated before alerting. Absorbs cron jitter and slow runs."
              error={err("graceSec")}
            >
              <Input
                id="graceSec"
                name="graceSec"
                type="number"
                min={0}
                max={86400}
                defaultValue={monitor?.graceSec ?? 120}
              />
            </Field>
          ) : (
            <Field
              label="Timeout (ms)"
              htmlFor="timeoutMs"
              hint="Give up and record a failure after this long."
              error={err("timeoutMs")}
            >
              <Input
                id="timeoutMs"
                name="timeoutMs"
                type="number"
                min={500}
                max={120000}
                defaultValue={monitor?.timeoutMs ?? 10000}
              />
            </Field>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Failures before alerting"
            htmlFor="confirmFailures"
            hint="2 removes almost all false alarms from transient blips, at the cost of one interval of detection latency."
            error={err("confirmFailures")}
          >
            <Input
              id="confirmFailures"
              name="confirmFailures"
              type="number"
              min={1}
              max={10}
              defaultValue={monitor?.confirmFailures ?? 2}
            />
          </Field>

          <Field
            label="Successes before recovery"
            htmlFor="confirmRecoveries"
            hint="Guards against declaring victory on one lucky response."
            error={err("confirmRecoveries")}
          >
            <Input
              id="confirmRecoveries"
              name="confirmRecoveries"
              type="number"
              min={1}
              max={10}
              defaultValue={monitor?.confirmRecoveries ?? 2}
            />
          </Field>
        </div>

        {usesNetwork ? (
          <Field
            label="Degraded above (ms)"
            htmlFor="degradedMs"
            hint="Responses slower than this count as degraded — available, but not healthy. Leave blank to disable."
            error={err("degradedMs")}
          >
            <Input
              id="degradedMs"
              name="degradedMs"
              type="number"
              min={0}
              max={120000}
              defaultValue={monitor?.degradedMs ?? ""}
              placeholder="e.g. 500"
            />
          </Field>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="SLO target (%)"
            htmlFor="sloTargetPct"
            hint="Drives the error-budget burn-down. 99.9% allows ~43 minutes a month."
            error={err("sloTargetPct")}
          >
            <Input
              id="sloTargetPct"
              name="sloTargetPct"
              type="number"
              step="0.01"
              min={50}
              max={100}
              defaultValue={monitor?.sloTargetPct ?? 99.9}
            />
          </Field>

          {kind === "ssl" || isHttp ? (
            <Field
              label="Warn before cert expiry (days)"
              htmlFor="sslWarnDays"
              hint="The monitor turns degraded once expiry falls inside this window."
            >
              <Input
                id="sslWarnDays"
                name="sslWarnDays"
                type="number"
                min={1}
                max={365}
                defaultValue={monitor?.sslWarnDays ?? 21}
              />
            </Field>
          ) : null}
        </div>
      </Panel>

      {/* ---- alerting ---------------------------------------------------- */}
      <Panel inset className="flex flex-col gap-5">
        <SectionHeader label="alerting" />
        <Rule />

        {channels.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-ash">
            No alert channels exist yet, so this monitor will record outages but tell
            nobody about them.{" "}
            <Link href="/channels" className="text-amp hover:underline">
              Add a channel
            </Link>{" "}
            to fix that.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <MonoLabel>notify these channels</MonoLabel>
            {channels.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  name="channelIds"
                  value={c.id}
                  defaultChecked={attachedChannelIds.includes(c.id)}
                  className="size-3.5 appearance-none border border-hairline bg-void checked:border-amp checked:bg-amp"
                />
                <span className="text-[13px] text-bone">{c.name}</span>
                <MonoLabel tone="slate">{c.kind}</MonoLabel>
              </label>
            ))}
          </div>
        )}

        <Rule />
        <Switch
          name="paused"
          label="Paused"
          hint="Keeps the configuration and history, stops probing and alerting."
          defaultChecked={monitor?.paused ?? false}
        />
      </Panel>

      <div className="flex items-center gap-5">
        <Submit label={editing ? "Save changes" : "Create monitor"} />
        <Link
          href={editing ? `/monitors/${monitor!.id}` : "/monitors"}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate hover:text-ash"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
