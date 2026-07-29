"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import {
  acknowledgeIncident,
  commentOnIncident,
  resolveIncidentManually,
} from "./engine";

export async function acknowledgeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) acknowledgeIncident(id, user.id, user.name);
  revalidatePath(`/incidents/${id}`);
  revalidatePath("/incidents");
  revalidatePath("/dashboard");
}

export async function commentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const message = String(formData.get("message") ?? "");
  if (id && message.trim()) commentOnIncident(id, user.id, message);
  revalidatePath(`/incidents/${id}`);
}

export async function resolveAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) resolveIncidentManually(id, user.id, user.name);
  revalidatePath(`/incidents/${id}`);
  revalidatePath("/incidents");
  revalidatePath("/dashboard");
}
