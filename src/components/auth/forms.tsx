"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  acceptInviteAction,
  loginAction,
  setupAction,
  type ActionState,
} from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";

const initial: ActionState = {};

/**
 * Submit button that reflects the pending transition. Uses useFormStatus so it
 * stays a leaf and does not re-render the whole form on every keystroke.
 */
function Submit({ children, pendingLabel }: { children: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="solid"
      disabled={pending}
      className="relative w-full overflow-hidden"
    >
      {pending ? pendingLabel : children}
      {pending ? <span className="anim-sweep absolute inset-x-0 bottom-0 h-0.5" /> : null}
    </Button>
  );
}

export function SetupForm() {
  const [state, action] = useActionState(setupAction, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError>{state.error}</FormError>
      <Field label="Your name" htmlFor="name" required>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          autoFocus
          placeholder="Ada Lovelace"
        />
      </Field>
      <Field label="Email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@example.com"
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Length beats punctuation.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </Field>
      <Submit pendingLabel="Creating…">Create admin account</Submit>
    </form>
  );
}

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError>{state.error}</FormError>
      <Field label="Email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@example.com"
        />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Submit pendingLabel="Signing in…">Sign in</Submit>
    </form>
  );
}

export function InviteForm({
  token,
  email,
}: {
  token: string;
  /** Present when the invite was addressed to a specific person. */
  email: string | null;
}) {
  const [state, action] = useActionState(acceptInviteAction, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="token" value={token} />
      <Field label="Your name" htmlFor="name" required>
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </Field>
      {email ? (
        <Field label="Email" hint="Fixed by the invite.">
          <Input value={email} disabled readOnly />
        </Field>
      ) : (
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </Field>
      )}
      <Field
        label="Password"
        htmlFor="password"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </Field>
      <Submit pendingLabel="Joining…">Accept invite</Submit>
    </form>
  );
}
