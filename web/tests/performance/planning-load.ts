import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const baseURL = process.env.PERF_BASE_URL ?? "http://localhost:3000";
const storageStatePath = process.env.PERF_STORAGE_STATE;
const tripId = process.env.PERF_TRIP_ID;
const sampleCount = Number(process.env.PERF_PLANNING_SAMPLES ?? 5000);

function percentile(samples: number[], value: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(value * ordered.length) - 1)] ?? Infinity;
}

test("planning reads support 100 concurrent sessions and sustained 5,000 requests/hour", async ({
  playwright,
}) => {
  test.skip(
    !storageStatePath || !tripId,
    "Set PERF_STORAGE_STATE and PERF_TRIP_ID to a synthetic authenticated trip",
  );
  test.skip(
    process.env.PROVIDER_MODE !== "deterministic",
    "Load scenarios must use deterministic synthetic providers",
  );
  const state = JSON.parse(await readFile(storageStatePath!, "utf8"));
  const contexts = await Promise.all(
    Array.from({ length: 100 }, () =>
      playwright.request.newContext({ baseURL, storageState: state }),
    ),
  );
  try {
    const concurrent = await Promise.all(
      contexts.map(async (context) => {
        const started = performance.now();
        const response = await context.get(`/api/v1/trips/${tripId}`);
        expect(response.ok()).toBeTruthy();
        return performance.now() - started;
      }),
    );
    expect(percentile(concurrent, 0.95)).toBeLessThanOrEqual(300);

    const requestContext = contexts[0]!;
    const currentTrip = await requestContext.get(`/api/v1/trips/${tripId}`);
    const trip = (await currentTrip.json()) as {
      version: number;
      snapshot: { preferences: { pace: number } };
    };
    const editStarted = performance.now();
    const editPreview = await requestContext.post(`/api/v1/trips/${tripId}/commands/edit-preview`, {
      data: {
        requestId: randomUUID(),
        expectedVersion: trip.version,
        operations: [
          {
            operation: "replace",
            target: "/preferences/pace",
            value: trip.snapshot.preferences.pace === 100 ? 99 : trip.snapshot.preferences.pace + 1,
          },
        ],
      },
    });
    expect(editPreview.ok()).toBeTruthy();
    expect(performance.now() - editStarted).toBeLessThanOrEqual(300);
    const samples: number[] = [];
    // One minute at 5,000 requests/hour. Release acceptance still requires a full 60-minute soak.
    const finishAt = Date.now() + 60_000;
    let sequence = 0;
    while (Date.now() < finishAt && samples.length < sampleCount) {
      const started = performance.now();
      const response = await requestContext.post(`/api/v1/trips/${tripId}/agent-runs`, {
        data: {
          requestId: randomUUID(),
          baseTripVersion: trip.version,
          purpose: process.env.PERF_PURPOSE ?? "refinement",
          message: "Synthetic capacity measurement request",
        },
      });
      expect(response.status()).toBe(202);
      samples.push(performance.now() - started);
      sequence += 1;
      const nextAt = finishAt - 60_000 + sequence * 720;
      if (nextAt > Date.now())
        await new Promise((resolve) => setTimeout(resolve, nextAt - Date.now()));
    }
    expect(samples.length).toBeGreaterThanOrEqual(60);
    expect(percentile(samples, 0.95)).toBeLessThanOrEqual(300);
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()));
  }
});
