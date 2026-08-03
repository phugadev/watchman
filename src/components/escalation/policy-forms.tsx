"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import {
  addStepAction,
  createPolicyAction,
  updatePolicyAction,
  type EscalationActionState,
} from "@/lib/escalation/actions";

const initial: EscalationActionState = {};

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Common delays, offered as a datalist rather than a fixed select.
 *
 * The right second step is "however long you would want to pass before someone
 * else's phone rings", which is a judgement, not a menu — but nobody wants to
 * compute 900 in their head either.
 */
const DELAY_PRESETS = [
  { value: 0, label: "immediately" },
  { value: 300, label: "5 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
];

export function NewPolicyForm() {
  const [state, action] = useActionState(createPolicyAction, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="solid" size="sm" onClick={() => setOpen(true)}>
        new policy
      </Button>
    );
  }

  return (
    <Panel inset className="flex w-full flex-col gap-5">
      <SectionHeader label="new escalation policy">
        <Button type="button" variant="bracket" size="sm" onClick={() => setOpen(false)}>
          cancel
        </Button>
      </SectionHeader>
      <Rule />

      <form action={action} className="flex flex-col gap-5">
        <FormError>{state.error}</FormError>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="ep-name" required>
            <Input
              id="ep-name"
              name="name"
              placeholder="Tier 1 on-call"
              required
              maxLength={80}
            />
          </Field>

          <Field
            label="Repeat every (seconds)"
            htmlFor="ep-repeat"
            hint="Blank stops after the last step. Set it to keep re-notifying the last step until somebody acknowledges."
          >
            <Input
              id="ep-repeat"
              name="repeatSec"
              type="number"
              min={60}
              max={86400}
              placeholder="blank — do not repeat"
            />
          </Field>
        </div>

        <p className="text-[12px] leading-relaxed text-ash">
          A policy on its own does nothing. Add steps to it below, then attach it
          to a monitor from that monitor&rsquo;s alerting settings.
        </p>

        <Submit label="Create policy" pendingLabel="Creating…" />
      </form>
    </Panel>
  );
}

/** Edit a policy's name and repeat interval in place. */
export function EditPolicyForm({
  policy,
}: {
  policy: { id: string; name: string; repeatSec: number | null };
}) {
  const [state, action] = useActionState(updatePolicyAction, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={policy.id} />
      <FormError>{state.error}</FormError>

      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Field label="Name" htmlFor={`name-${policy.id}`}>
          <Input
            id={`name-${policy.id}`}
            name="name"
            defaultValue={policy.name}
            maxLength={80}
            required
          />
        </Field>
        <Field label="Repeat (s)" htmlFor={`repeat-${policy.id}`}>
          <Input
            id={`repeat-${policy.id}`}
            name="repeatSec"
            type="number"
            min={60}
            max={86400}
            defaultValue={policy.repeatSec ?? ""}
            placeholder="never"
          />
        </Field>
        <Submit label="save" pendingLabel="saving" />
      </div>
    </form>
  );
}

/** Append a step to a policy. */
export function AddStepForm({
  policyId,
  channels,
  stepCount,
}: {
  policyId: string;
  channels: { id: string; name: string; kind: string }[];
  stepCount: number;
}) {
  const [state, action] = useActionState(addStepAction, initial);

  // The first step almost always wants to fire immediately; later ones want a
  // gap. Defaulting to "now" for step 2 would make the policy notify twice at
  // once, which reads as a bug in Watchman rather than a choice.
  const suggested = stepCount === 0 ? 0 : 900;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="policyId" value={policyId} />
      <FormError>{state.error}</FormError>

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Field label="After (s)" htmlFor={`after-${policyId}`}>
          <Input
            id={`after-${policyId}`}
            name="afterSec"
            type="number"
            min={0}
            max={86400}
            defaultValue={suggested}
            list={`delays-${policyId}`}
            required
          />
          <datalist id={`delays-${policyId}`}>
            {DELAY_PRESETS.map((d) => (
              <option key={d.value} value={d.value} label={d.label} />
            ))}
          </datalist>
        </Field>

        <Field label="Notify" htmlFor={`channel-${policyId}`}>
          <Select id={`channel-${policyId}`} name="channelId" required>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.kind})
              </option>
            ))}
          </Select>
        </Field>

        <Submit label="add step" pendingLabel="adding" />
      </div>
    </form>
  );
}
