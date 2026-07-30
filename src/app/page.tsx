import { redirect } from "next/navigation";
import { getCurrentUser, needsSetup } from "@/lib/auth/session";

/**
 * Where this route sends you depends on whether the instance is claimed and whether you
 * are signed in — both live state. Prerendering it would freeze the answer from build
 * time, when neither is true.
 */
export const dynamic = "force-dynamic";

export default async function RootPage() {
  if (needsSetup()) redirect("/setup");
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
