"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Switch } from "@/components/ui/field";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import {
  createStatusPageAction,
  updateStatusPageAction,
  type StatusPageActionState,
} from "@/lib/status-pages/actions";
import type { StatusPage } from "@/lib/db/schema";

const initial: StatusPageActionState = {};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function StatusPageForm({
  monitors,
  page,
  selectedMonitorIds = [],
}: {
  monitors: { id: string; name: string; kind: string }[];
  page?: StatusPage;
  selectedMonitorIds?: string[];
}) {
  const editing = Boolean(page);
  const [state, action] = useActionState(
    editing ? updateStatusPageAction : createStatusPageAction,
    initial,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant={editing ? "bracket" : "solid"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {editing ? "edit page" : "new status page"}
      </Button>
    );
  }

  const body = (
    <form action={action} className="flex flex-col gap-5">
      {editing ? <input type="hidden" name="id" value={page!.id} /> : null}
      <FormError>{state.error}</FormError>
      {state.ok ? (
        <p className="border border-live/40 bg-live/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-live">
          Saved
        </p>
      ) : null}

      <Field label="Title" htmlFor={`sp-title-${page?.id ?? "new"}`} required>
        <Input
          id={`sp-title-${page?.id ?? "new"}`}
          name="title"
          defaultValue={page?.title}
          placeholder="Acme Status"
          required
          maxLength={120}
        />
      </Field>

      {!editing ? (
        <Field
          label="URL slug"
          htmlFor="sp-slug"
          hint="Optional — derived from the title if left blank. Cannot be changed later, because the URL may already be shared."
        >
          <Input id="sp-slug" name="slug" placeholder="status" spellCheck={false} />
        </Field>
      ) : null}

      <Field
        label="Description"
        htmlFor={`sp-desc-${page?.id ?? "new"}`}
        hint="One line, shown under the title."
      >
        <Input
          id={`sp-desc-${page?.id ?? "new"}`}
          name="description"
          defaultValue={page?.description ?? ""}
          placeholder="Live availability for our public services."
          maxLength={300}
        />
      </Field>

      <Rule />

      <div className="flex flex-col gap-3">
        <MonoLabel>monitors to publish</MonoLabel>
        <p className="text-[11px] leading-relaxed text-slate">
          Only what you pick is public. Internal monitors — a database port, a
          staging box — are best left off.
        </p>
        {monitors.length === 0 ? (
          <p className="text-[12px] text-warn">Create a monitor first.</p>
        ) : (
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
            {monitors.map((m) => (
              <label key={m.id} className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  name="monitorIds"
                  value={m.id}
                  defaultChecked={selectedMonitorIds.includes(m.id)}
                  className="size-3.5 shrink-0 appearance-none border border-hairline bg-void checked:border-amp checked:bg-amp"
                />
                <span className="truncate text-[13px] text-bone">{m.name}</span>
                <MonoLabel tone="slate">{m.kind}</MonoLabel>
              </label>
            ))}
          </div>
        )}
      </div>

      <Rule />

      <Switch
        name="published"
        label="Published"
        hint="Unpublished pages 404 for the public but stay visible to signed-in users."
        defaultChecked={page?.published ?? false}
      />
      <Switch
        name="showGrades"
        label="Show grades"
        hint="Displays the S–F letter beside each service."
        defaultChecked={page?.showGrades ?? true}
      />
      <Switch
        name="showLatency"
        label="Show response times"
        hint="Publishes p95 latency. Turn off if you would rather not commit to numbers publicly."
        defaultChecked={page?.showLatency ?? true}
      />

      <div className="flex items-center gap-4">
        <Submit label={editing ? "Save page" : "Create page"} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate hover:text-ash"
        >
          Close
        </button>
      </div>
    </form>
  );

  // Editing happens inline within an existing card; creating gets its own panel.
  if (editing) return <div className="flex flex-col gap-4">{body}</div>;

  return (
    <Panel inset className="flex w-full flex-col gap-5">
      <SectionHeader label="new status page">
        <Button type="button" variant="bracket" size="sm" onClick={() => setOpen(false)}>
          cancel
        </Button>
      </SectionHeader>
      <Rule />
      {body}
    </Panel>
  );
}
