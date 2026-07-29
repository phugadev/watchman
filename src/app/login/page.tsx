import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/forms";
import { getCurrentUser, needsSetup } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (needsSetup()) redirect("/setup");
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <AuthShell
      eyebrow="restricted"
      title="Sign in"
      footer="Ask an administrator for an invite link if you don't have an account."
    >
      <LoginForm />
    </AuthShell>
  );
}
