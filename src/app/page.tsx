import { redirect } from "next/navigation";
import { getCurrentUser, needsSetup } from "@/lib/auth/session";

export default async function RootPage() {
  if (needsSetup()) redirect("/setup");
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
