import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { InviteForm } from "@/components/auth/forms";
import { findUsableInvite } from "@/lib/auth/invites";

export const metadata: Metadata = { title: "Accept invite" };

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = findUsableInvite(token);

  if (!invite) {
    return (
      <AuthShell
        eyebrow="invite"
        title="This link is no longer valid"
        intro="Invites expire, and each one can only be used once. Ask an administrator to send you a fresh link."
      >
        <Link
          href="/login"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-amp hover:underline"
        >
          Go to sign in →
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={invite.role === "admin" ? "admin invite" : "invite"}
      title="Join this Watchman"
      intro={
        invite.role === "admin"
          ? "You'll join as an administrator, with access to monitors, alerting, and team settings."
          : "You'll be able to see monitors and incidents, and acknowledge alerts."
      }
    >
      <InviteForm token={token} email={invite.email} />
    </AuthShell>
  );
}
