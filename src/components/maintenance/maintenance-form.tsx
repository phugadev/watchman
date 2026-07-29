"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Switch } from "@/components/ui/field";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import {
  createMaintenanceAction,
  type MaintenanceActionState,
} from "@/lib/maintenance/actions";

const initial: MaintenanceActionState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" size="sm" disabled={pending}>
      {pending ? "Scheduling…" : "Schedule window"}
    </Button>
  );
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not an ISO UTC string. */
function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function MaintenanceForm({
  monitors,
}: {
  monitors: { id: string; name: string; kind: string }[];
}) {
  const [state, action] = useActionState(createMaintenanceAction, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="solid" size="sm" onClick={() => setOpen(true)}>
        schedule window
      </Button>
    );
  }

  // Default to the next round hour, one hour long — the shape of most deploys.
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3_600_000);

  return (
    <Panel inset className="flex w-full flex-col gap-5">
      <SectionHeader label="schedule maintenance">
        <Button type="button" variant="bracket" size="sm" onClick={() => setOpen(false)}>
          cancel
        </Button>
      </SectionHeader>
      <Rule />

      <form action={action} className="flex flex-col gap-5">
        <FormError>{state.error}</FormError>
        {state.ok ? (
          <p className="border border-live/40 bg-live/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-live">
            Window scheduled
          </p>
        ) : null}

        <Field label="Title" htmlFor="mw-title" required>
          <Input
            id="mw-title"
            name="title"
            placeholder="Database upgrade"
            required
            maxLength={120}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Starts" htmlFor="mw-start" required hint="Your local time.">
            <Input
              id="mw-start"
              name="startsAt"
              type="datetime-local"
              defaultValue={localInputValue(start)}
              required
            />
          </Field>
          <Field label="Ends" htmlFor="mw-end" required>
            <Input
              id="mw-end"
              name="endsAt"
              type="datetime-local"
              defaultValue={localInputValue(end)}
              required
            />
          </Field>
        </div>

        <Field
          label="Notes"
          htmlFor="mw-notes"
          hint="Optional. Shown alongside the window."
        >
          <Input id="mw-notes" name="notes" maxLength={500} />
        </Field>

        <Rule />

        <div className="flex flex-col gap-3">
          <MonoLabel>affected monitors</MonoLabel>
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
          name="suppressAlerts"
          label="Suppress alerts"
          hint="Keep probing and recording, but send nothing. Almost always what you want — you still get the timeline afterwards."
          defaultChecked
        />
        <Switch
          name="pauseChecks"
          label="Pause checks entirely"
          hint="Stop probing for the duration. Only for maintenance where the service is intentionally offline and the failure data is noise."
        />

        <Submit />
      </form>
    </Panel>
  );
}
