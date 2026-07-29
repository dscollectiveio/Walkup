"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { DEV_USERS, DEV_USER_COOKIE } from "@/lib/session";

/** Development only. See src/lib/session.ts. */
export async function switchDevUser(formData: FormData) {
  const id = String(formData.get("userId") ?? "");
  if (!DEV_USERS.some((u) => u.id === id)) return;

  const store = await cookies();
  store.set(DEV_USER_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
}
