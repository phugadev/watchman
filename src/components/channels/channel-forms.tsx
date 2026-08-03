"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Field,
  FormError,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/ui/field";
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

        <KindFields kind={kind} />

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
 * The fields that differ per channel type.
 *
 * Only the selected kind's inputs are mounted, rather than all five being
 * rendered and hidden. An unmounted input submits nothing, which is what keeps
 * the server action from having to work out whether a `botToken` in the payload
 * of an email channel was meaningful.
 */
function KindFields({ kind }: { kind: ChannelKind }) {
  switch (kind) {
    case "webhook":
      return (
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
      );

    case "telegram":
      return (
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
      );

    case "email":
      return (
        <>
          <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
            <Field label="SMTP host" htmlFor="ch-host" required>
              <Input
                id="ch-host"
                name="host"
                placeholder="smtp.example.com"
                required
                spellCheck={false}
              />
            </Field>
            <Field label="Port" htmlFor="ch-port" required>
              <Input
                id="ch-port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={587}
                required
              />
            </Field>
          </div>

          <Switch
            name="secure"
            label="Implicit TLS"
            hint="On for port 465, where the session is encrypted from the first byte. Leave off for 587, which starts in the clear and upgrades with STARTTLS."
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Username"
              htmlFor="ch-user"
              hint="Leave both blank to relay through an MTA that does not authenticate."
            >
              <Input
                id="ch-user"
                name="user"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Password" htmlFor="ch-pass">
              <Input
                id="ch-pass"
                name="pass"
                type="password"
                autoComplete="new-password"
              />
            </Field>
          </div>

          <Field
            label="From"
            htmlFor="ch-from"
            required
            hint="Must be an address the server will accept as a sender, or it will reject the message."
          >
            <Input
              id="ch-from"
              name="from"
              placeholder="watchman@example.com"
              required
              spellCheck={false}
            />
          </Field>

          <Field
            label="Recipients"
            htmlFor="ch-to"
            required
            hint="One per line, or comma-separated."
          >
            <Textarea
              id="ch-to"
              name="to"
              rows={3}
              placeholder={"oncall@example.com\nops@example.com"}
              required
              spellCheck={false}
            />
          </Field>
        </>
      );

    case "slack":
      return (
        <Field
          label="Incoming webhook URL"
          htmlFor="ch-slack"
          required
          hint="Slack → your app → Incoming Webhooks → Add New Webhook to Workspace. The URL is the credential; it chooses the channel too."
        >
          <Input
            id="ch-slack"
            name="webhookUrl"
            type="url"
            placeholder="https://hooks.slack.com/services/T00/B00/xxxx"
            required
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
      );

    case "discord":
      return (
        <Field
          label="Webhook URL"
          htmlFor="ch-discord"
          required
          hint="Channel settings → Integrations → Webhooks → New Webhook, then Copy Webhook URL."
        >
          <Input
            id="ch-discord"
            name="webhookUrl"
            type="url"
            placeholder="https://discord.com/api/webhooks/123/xxxx"
            required
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
      );

    default: {
      const exhaustive: never = kind;
      return <FormError>Unsupported channel type: {String(exhaustive)}</FormError>;
    }
  }
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
