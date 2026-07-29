# Contributing to Watchman

Thanks for looking. This file covers how to get set up and the few conventions that
are load-bearing.

## Getting started

```bash
pnpm install
pnpm seed     # 30 days of synthetic history across all five monitor kinds
pnpm dev
```

The seed prints its credentials. It refuses to run against a database that already has
users, so you cannot lose real data to it. To start over: `rm -rf data && pnpm seed`.

Before opening a PR:

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` catches things `pnpm typecheck` does not — SWC and tsc disagree about a
few TypeScript forms, so a green typecheck is not proof the build works.

## Conventions worth knowing

**Keep probe and metric logic pure.** Everything in `lib/probe` and `lib/metrics`, and
the state machine in `lib/incidents/state-machine.ts`, takes plain values and returns
plain values with no database or network access. That is why they have real test
coverage. If you add logic there, add tests; if you find yourself needing `db` inside
one, the logic probably belongs in the layer above.

**The scheduler is the only writer of monitor hot state.** `last_status`,
`consecutive_failures`, and friends are denormalised for dashboard reads. Writing them
from anywhere else will produce a dashboard that disagrees with the check history.

**Do not hold a SQLite write transaction across a network call.** It blocks every other
probe for the duration. Queue the side effect and run it after the commit — see
`recordCheck` for the pattern.

**Colour is signal.** Mint means operational, amber degraded, red down, acid yellow
attention. Nothing in the UI is coloured decoratively, and adding a sixth accent will
be pushed back on. Squares, not rounded corners; radius is reserved for pills and
avatars.

**Never leak internal detail onto a public status page.** A raw `ECONNREFUSED` tells a
customer nothing and describes your topology. Status pages say "we are investigating".

**Alert noise is a bug.** Anything that could make Watchman notify more often needs a
reason. The confirmation delays, flap dampening, degraded-transition-only rule, and
maintenance windows all exist because a channel people mute is worse than no channel.

## Adding a monitor kind

1. Write the probe in `src/lib/probe/<kind>.ts`, returning a `ProbeResult`. Keep it
   pure apart from the network call itself, and translate error codes into language an
   operator can act on — see `describeError`.
2. Add the kind to `MONITOR_KINDS` in `src/lib/db/schema.ts` and run
   `pnpm db:generate`.
3. Route it in `runProbe`, and add labels to `KIND_LABEL` / `KIND_HINT`.
4. Add validation to `monitorFormSchema` — target requirements differ per kind, which
   is what `superRefine` is for.
5. Show or hide the relevant fields in `MonitorForm`. Fields appear and disappear with
   the kind rather than being greyed out; eleven inert inputs make the form look far
   harder than the task.

## Adding a notification channel

1. Add a zod config schema to `src/lib/notify/types.ts` and register it in
   `configSchemas`. Config is parsed on every read, so a hand-edited row cannot crash
   the notifier mid-outage.
2. Write `deliver<Channel>` returning a `DeliveryResult`. Surface the provider's own
   error text — "chat not found" beats a status code.
3. Add the kind to `CHANNEL_KINDS`, run `pnpm db:generate`, and wire the branch in
   `deliverWithRetry`.
4. Add form fields in `channel-forms.tsx`, and mask any credential everywhere it
   surfaces.

## Reporting bugs

For anything alerting-related, please include: monitor kind, interval,
`confirmFailures` / `confirmRecoveries`, and what you expected to be notified about
versus what arrived. The delivery log on the incident page and the channels page is
usually the fastest way to tell "Watchman did not alert" from "the alert did not get
through".
