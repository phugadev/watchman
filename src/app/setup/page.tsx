import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SetupForm } from "@/components/auth/forms";
import { needsSetup } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set up" };

/**
 * Must be evaluated per request.
 *
 * This page reads whether any account exists, and that answer changes the moment
 * someone claims the instance. Next would otherwise prerender it — it touches no
 * cookies and so looks static — freezing the check at build time and serving the setup
 * form forever to an instance that is already claimed. (The action behind it always
 * re-checks, so this was never a way in, only a confusing dead end.) Marking it dynamic
 * also stops `next build` from querying the database at all.
 */
export const dynamic = "force-dynamic";

export default function SetupPage() {
  // Once an account exists this route is closed for good — otherwise it would be
  // a permanent unauthenticated path to creating an admin.
  if (!needsSetup()) redirect("/login");

  return (
    <AuthShell
      eyebrow="first run"
      title="Claim this instance"
      intro="No accounts exist yet. The first one becomes the administrator and can invite the rest of your team."
    >
      <SetupForm />
    </AuthShell>
  );
}
