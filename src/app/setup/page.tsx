import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SetupForm } from "@/components/auth/forms";
import { needsSetup } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set up" };

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
