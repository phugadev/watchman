"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import {
  acknowledgeIncident,
  commentOnIncident,
  resolveIncidentManually,
} from "./engine";
import { formString } from "@/lib/forms";

export async function acknowledgeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formString(formData, "id");
  if (id) acknowledgeIncident(id, user.id, user.name);
  revalidatePath(`/incidents/${id}`);
  revalidatePath("/incidents");
  revalidatePath("/dashboard");
}

export async function commentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formString(formData, "id");
  const message = formString(formData, "message");
  if (id && message.trim()) commentOnIncident(id, user.id, message);
  revalidatePath(`/incidents/${id}`);
}

export async function resolveAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formString(formData, "id");
  if (id) resolveIncidentManually(id, user.id, user.name);
  revalidatePath(`/incidents/${id}`);
  revalidatePath("/incidents");
  revalidatePath("/dashboard");
}
