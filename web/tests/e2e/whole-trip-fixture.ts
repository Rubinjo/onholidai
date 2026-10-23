import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { bookingReviewStateSchema } from "../../domain/booking/public";

const execute = promisify(execFile);
export async function recordedWholeTripCommand(command: unknown): Promise<unknown> {
  const { stdout } = await execute(
    process.execPath,
    [
      "--conditions=react-server",
      "--experimental-transform-types",
      "--import",
      pathToFileURL(resolve("server", "workflows", "alias-loader.mjs")).href,
      resolve("tests", "helpers", "whole-trip-browser-fixture.ts"),
      JSON.stringify(command),
    ],
    { timeout: 30_000 },
  );
  return JSON.parse(stdout);
}
export const wholeTripInspectionSchema = z.object({
  review: bookingReviewStateSchema,
  authorizations: z.number().int(),
  transactions: z.number().int(),
  attempts: z.number().int(),
  outbox: z.number().int(),
});
export async function seedBrowserWholeTrip(page: Page, baseURL: string, incomplete = false) {
  const account = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: new URL(baseURL).origin },
    data: {
      name: "Synthetic whole-trip reviewer",
      email: `review-${crypto.randomUUID()}@example.invalid`,
      password: "Synthetic-browser-review-password-42!",
    },
  });
  await expect(account).toBeOK();
  const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await account.json());
  const state = bookingReviewStateSchema.parse(
    await recordedWholeTripCommand({
      action: "seed",
      ownerUserId: user.id,
      incomplete,
    }),
  );
  return { state, ownerUserId: user.id, tripId: state.tripId };
}
