"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { changePasswordAction, type ActionState } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";

const initial: ActionState = {};

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, initial);
  const { pending } = useFormStatus();

  return (
    <form action={action} className="flex max-w-sm flex-col gap-5">
      <FormError>{state.error}</FormError>
      {state.ok ? (
        <p className="border border-live/40 bg-live/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-live">
          Password changed — other sessions signed out
        </p>
      ) : null}

      <Field label="Current password" htmlFor="current" required>
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        label="New password"
        htmlFor="new-password"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Changing it signs out every other session.`}
      >
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </Field>

      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
