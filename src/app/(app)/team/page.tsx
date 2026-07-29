import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Panel, Rule, SectionHeader } from "@/components/ui/frame";
import { MonoLabel } from "@/components/ui/mono";
import { InviteCreator } from "@/components/auth/invite-creator";
import { requireAdmin } from "@/lib/auth/session";
import {
  removeUserAction,
  revokeInviteAction,
  setUserRoleAction,
} from "@/lib/auth/actions";
import { formatAgo } from "@/lib/metrics/uptime";
import { listPendingInvites, listTeam } from "@/lib/queries";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const admin = await requireAdmin();
  const team = listTeam();
  const invites = listPendingInvites();
  const adminCount = team.filter((u) => u.role === "admin").length;

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <SectionHeader label={`team · ${team.length}`} />

      <Panel className="divide-y divide-hairline-soft">
        {team.map((u) => {
          const isSelf = u.id === admin.id;
          // Guard rails matching the server actions, so the UI never offers a
          // button that would be silently refused.
          const lastAdmin = u.role === "admin" && adminCount <= 1;

          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2.5">
                  <span className="truncate text-[13px] text-bone">{u.name}</span>
                  {isSelf ? <MonoLabel tone="amp">you</MonoLabel> : null}
                </div>
                <span className="truncate font-mono text-[11px] text-slate">
                  {u.email}
                </span>
              </div>

              <MonoLabel tone={u.role === "admin" ? "bone" : "slate"}>
                {u.role}
              </MonoLabel>

              <span className="w-28 shrink-0 text-right font-mono text-[10px] text-slate">
                {u.lastSeenAt ? formatAgo(u.lastSeenAt) : "never signed in"}
              </span>

              <div className="flex shrink-0 items-center gap-2">
                {!lastAdmin ? (
                  <form action={setUserRoleAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <input
                      type="hidden"
                      name="role"
                      value={u.role === "admin" ? "member" : "admin"}
                    />
                    <Button type="submit" variant="bracket" size="sm">
                      {u.role === "admin" ? "demote" : "promote"}
                    </Button>
                  </form>
                ) : null}

                {!isSelf && !lastAdmin ? (
                  <form action={removeUserAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <Button
                      type="submit"
                      variant="bracket"
                      size="sm"
                      className="hover:text-alarm"
                    >
                      remove
                    </Button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
      </Panel>

      <Panel inset className="flex flex-col gap-4">
        <SectionHeader label="invite someone" />
        <Rule />
        <InviteCreator />
      </Panel>

      {invites.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader label={`pending invites · ${invites.length}`} />
          <Panel className="divide-y divide-hairline-soft">
            {invites.map(({ invite, createdByName }) => {
              const expired = invite.expiresAt.getTime() < Date.now();
              return (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ash">
                    {invite.email ?? "open invite — any email"}
                  </span>
                  <MonoLabel tone="slate">{invite.role}</MonoLabel>
                  <MonoLabel tone={expired ? "alarm" : "slate"}>
                    {expired
                      ? "expired"
                      : `expires ${invite.expiresAt.toLocaleDateString()}`}
                  </MonoLabel>
                  {createdByName ? (
                    <span className="hidden font-mono text-[10px] text-slate sm:inline">
                      by {createdByName}
                    </span>
                  ) : null}
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="id" value={invite.id} />
                    <Button
                      type="submit"
                      variant="bracket"
                      size="sm"
                      className="hover:text-alarm"
                    >
                      revoke
                    </Button>
                  </form>
                </div>
              );
            })}
          </Panel>
          <p className="text-[11px] leading-relaxed text-slate">
            Invite links are shown once, when created, and only their hash is stored —
            so a link cannot be recovered later. Revoke and re-issue if one is lost.
          </p>
        </section>
      ) : null}
    </div>
  );
}
