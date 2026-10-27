"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getApplication } from "@/server/application";
import { signOut } from "@/server/auth/auth";

export async function signOutAction() {
  await signOut(getApplication().auth, await headers());
  redirect("/sign-in");
}
