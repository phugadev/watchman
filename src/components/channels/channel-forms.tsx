"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Switch } from "@/components/ui/field";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import {
  createChannelAction,
  rotateWebhookSecretAction,
  testChannelAction,
  type ChannelActionState,
} from "@/lib/notify/actions";
import { CHANNEL_HINT, CHANNEL_LABEL } from "@/lib/notify/types";
import { CHANNEL_KINDS, type ChannelKind } from "@/lib/db/schema";

const initial: ChannelActionState = {};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function NewChannelForm() {
  const [state, action] = useActionState(createChannelAction, initial);
  const [kind, setKind] = useState<ChannelKind>("webhook");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="solid" size="sm" onClick={() => setOpen(true)}>
        new channel
      </Button>
    );
  }

  return (
    <Panel inset className="flex w-full flex-col gap-5">
      <SectionHeader label="new alert channel">
        <Button type="button" variant="bracket" size="sm" onClick={() => setOpen(false)}>
          cancel
        </Button>
      </SectionHeader>
      <Rule />

      <form action={action} className="flex flex-col gap-5">
        <FormError>{state.error}</FormError>
        {state.ok && !state.secret ? (
          <p className="border border-live/40 bg-live/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-live">
            Channel created
          </p>
        ) : null}
        {state.secret ? <SecretReveal secret={state.secret} /> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="ch-name" required>
            <Input
              id="ch-name"
              name="name"
              placeholder="On-call Telegram"
              required
              maxLength={80}
            />
          </Field>

          <Field label="Type" htmlFor="ch-kind" hint={CHANNEL_HINT[kind]}>
            <Select
              id="ch-kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ChannelKind)}
            >
              {CHANNEL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CHANNEL_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {kind === "webhook" ? (
          <Field
            label="Endpoint URL"
            htmlFor="ch-url"
            required
            hint="Watchman POSTs signed JSON here. A signing secret is generated for you and shown after you save."
          >
            <Input
              id="ch-url"
              name="url"
              type="url"
              placeholder="https://hooks.example.com/watchman"
              required
              spellCheck={false}
            />
          </Field>
        ) : (
          <>
            <Field
              label="Bot token"
              htmlFor="ch-token"
              required
              hint="Message @BotFather on Telegram and run /newbot to get one."
            >
              <Input
                id="ch-token"
                name="botToken"
                placeholder="123456789:AA…"
                required
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Chat id"
              htmlFor="ch-chat"
              required
              hint="Your numeric user id, or a @channelname. Add the bot to the chat first, or it cannot post."
            >
              <Input
                id="ch-chat"
                name="chatId"
                placeholder="-1001234567890"
                required
                spellCheck={false}
              />
            </Field>
            <Switch
              name="silent"
              label="Send silently"
              hint="Delivers without a notification sound. Suitable for a low-priority feed."
            />
          </>
        )}

        <Rule />
        <Switch
          name="notifyOnRecovery"
          label="Notify on recovery"
          hint="Send an all-clear when a monitor comes back."
          defaultChecked
        />
        <Switch
          name="notifyOnDegraded"
          label="Notify on degraded"
          hint="Also alert when a monitor becomes slow but is still responding. Off by default — this is the setting most likely to cause alert fatigue."
        />

        <div className="flex items-center gap-4">
          <Submit label="Create channel" />
        </div>
      </form>
    </Panel>
  );
}

/**
 * One-time display of a generated signing secret.
 *
 * Only a masked prefix is ever shown afterwards and nothing reveals the stored value,
 * so this is the single moment the receiver can be configured. Says so plainly, or
 * someone navigates away and has to rotate.
 */
function SecretReveal({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked over plain HTTP; the text stays selectable.
    }
  };

  return (
    <div className="flex flex-col gap-2.5 border border-amp/40 bg-amp/5 p-4">
      <MonoLabel tone="amp">signing secret — shown once</MonoLabel>
      <div className="flex items-center gap-2 border border-hairline-soft bg-void px-3 py-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-amp">
          {secret}
        </code>
        <Button type="button" variant="bracket" size="sm" onClick={() => void copy()}>
          {copied ? "copied" : "copy"}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-ash">
        Your receiver needs this to verify the <code>x-watchman-signature</code>{" "}
        header. Watchman will not show it again — rotate the channel if you lose it.
      </p>
    </div>
  );
}

/** Rotate a webhook secret, revealing the replacement once. */
export function RotateSecretButton({ channelId }: { channelId: string }) {
  const [state, action] = useActionState(rotateWebhookSecretAction, initial);

  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <input type="hidden" name="id" value={channelId} />
        <RotateSubmit />
      </form>
      <FormError>{state.error}</FormError>
      {state.secret ? <SecretReveal secret={state.secret} /> : null}
    </div>
  );
}

function RotateSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="bracket" size="sm" disabled={pending}>
      {pending ? "rotating" : "rotate secret"}
    </Button>
  );
}

/**
 * Test-send button.
 *
 * A channel that has never been exercised is a channel you do not know works, and
 * the moment you find out is during an outage. This makes verifying it a one-click
 * step at setup time.
 */
export function TestChannelButton({ channelId }: { channelId: string }) {
  const [state, action] = useActionState(testChannelAction, initial);
  const { ok, message } = state.testResult ?? {};

  return (
    <form action={action} className="flex items-center gap-2.5">
      <input type="hidden" name="id" value={channelId} />
      <TestSubmit />
      {message ? (
        <MonoLabel tone={ok ? "live" : "alarm"} className="max-w-[16rem] truncate">
          {message}
        </MonoLabel>
      ) : null}
    </form>
  );
}

function TestSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="bracket" size="sm" disabled={pending}>
      {pending ? "sending" : "test"}
    </Button>
  );
}
