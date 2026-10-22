import { expect, type Page } from "@playwright/test";

export type InputTiming = { action: string; milliseconds: number };
// Measures browser-visible acknowledgement, not network/research completion.
// Playwright actionability/scrolling and assertion overhead are included.
export async function acknowledge(
  page: Page,
  samples: InputTiming[],
  action: string,
  input: () => Promise<unknown>,
  outcome: () => Promise<unknown>,
) {
  const started = await page.evaluate(() => performance.now());
  await input();
  await outcome();
  const milliseconds = (await page.evaluate(() => performance.now())) - started;
  samples.push({ action, milliseconds });
  expect(milliseconds, `${action} acknowledgement`).toBeLessThanOrEqual(1000);
}
