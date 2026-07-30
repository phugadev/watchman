"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { MonoLabel } from "@/components/ui/mono";
import { createInviteAction, type ActionState } from "@/lib/auth/actions";

const initial: ActionState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" size="sm" disabled={pending}>
      {pending ? "Creating…" : "Create invite link"}
    </Button>
  );
}

/**
 * Invite creation.
 *
 * The resulting URL is shown exactly once — only its hash is persisted — so the
 * copy affordance has to be prominent and the one-time nature has to be stated
 * plainly, or someone will navigate away and lose it.
 */
export function InviteCreator() {
  const [state, action] = useActionState(createInviteAction, initial);
  const [copied, setCopied] = useState(false);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be blocked; the text stays selectable regardless.
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-5">
        <FormError>{state.error}</FormError>

        <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
          <Field
            label="Email"
            htmlFor="invite-email"
            hint="Optional. If set, the invite only works for that address. Leave blank for a link anyone can use once."
          >
            <Input
              id="invite-email"
              name="email"
              type="email"
              placeholder="teammate@example.com"
            />
          </Field>

          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue="member">
              <option value="member">member</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
        </div>

        <Submit />
      </form>

      {state.inviteUrl ? (
        <div className="flex flex-col gap-2.5 border border-amp/40 bg-amp/5 p-4">
          <MonoLabel tone="amp">copy this now — it is shown once</MonoLabel>
          <div className="flex items-center gap-2 border border-hairline-soft bg-void px-3 py-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-amp">
              {state.inviteUrl}
            </code>
            <Button
              type="button"
              variant="bracket"
              size="sm"
              onClick={() => void copy(state.inviteUrl!)}
            >
              {copied ? "copied" : "copy"}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-ash">
            Watchman stores only a hash of this token, so it cannot show you the link
            again. Send it over a channel you trust — anyone holding it can create an
            account.
          </p>
        </div>
      ) : null}
    </div>
  );
}
