import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const baseURL = process.env.PERF_BASE_URL ?? "http://localhost:3000";
const storageStatePath = process.env.PERF_STORAGE_STATE;
const tripIds = (process.env.PERF_AUTHORIZED_TRIP_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

test("20 authorized booking starts per minute acknowledge and expose first status within budget", async ({
  playwright,
}) => {
  test.skip(
    !storageStatePath || tripIds.length < 20,
    "Set PERF_STORAGE_STATE and 20 comma-separated synthetic, authorized PERF_AUTHORIZED_TRIP_IDS",
  );
  test.skip(
    process.env.PROVIDER_MODE !== "deterministic",
    "Booking load scenarios must use deterministic providers",
  );
  const state = JSON.parse(await readFile(storageStatePath!, "utf8"));
  const request = await playwright.request.newContext({ baseURL, storageState: state });
  try {
    const acknowledgements: number[] = [];
    const firstStatus: number[] = [];
    for (const tripId of tripIds.slice(0, 20)) {
      const authorizationId = process.env[`PERF_AUTHORIZATION_${tripId}`];
      if (!authorizationId) throw new Error(`Missing synthetic authorization for trip ${tripId}`);
      const requestId = randomUUID();
      const started = performance.now();
      const response = await request.post(`/api/v1/trips/${tripId}/bookings`, {
        data: { requestId, authorizationId },
      });
      expect(response.ok()).toBeTruthy();
      const booking = (await response.json()) as { id: string };
      acknowledgements.push(performance.now() - started);
      const statusStarted = performance.now();
      const status = await request.get(`/api/v1/bookings/${booking.id}`);
      expect(status.ok()).toBeTruthy();
      firstStatus.push(performance.now() - statusStarted);
      if (tripId !== tripIds.slice(0, 20).at(-1))
        await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    expect(Math.max(...acknowledgements)).toBeLessThanOrEqual(500);
    expect(Math.max(...firstStatus)).toBeLessThanOrEqual(5_000);
  } finally {
    await request.dispose();
  }
});
