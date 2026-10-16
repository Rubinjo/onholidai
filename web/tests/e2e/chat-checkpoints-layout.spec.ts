import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Rendered production components and built CSS; layout/focus evidence only, not
// a replacement for the separately gated real database/agent browser journeys.
const preview = resolve(".tmp/workspace-preview.html"), chunks = resolve(".next/static/chunks");
for (const width of [320, 390, 768, 1440]) test(`chat checkpoints fit and expose keyboard restore at ${width}px`, async ({ page }) => {
  test.skip(!existsSync(preview) || !existsSync(chunks), "Generate WORKSPACE_VISUAL_HTML with workspace-render.test.tsx and build CSS first");
  const css = readdirSync(chunks).filter((name) => name.endsWith(".css")).map((name) => readFileSync(resolve(chunks, name), "utf8")).join("\n");
  await page.setViewportSize({ width, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(`<!doctype html><html lang="en"><head><style>${css}</style></head><body>${readFileSync(preview, "utf8")}</body></html>`);
  const restore = page.getByRole("button", { name: "Restore trip to version 1" });
  await restore.focus(); await expect(restore).toBeFocused();
  const outline = await restore.evaluate((button) => getComputedStyle(button).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("link", { name: "Book trip" })).toHaveAttribute("href", /\/booking$/);
  await expect(page.getByRole("heading", { name: "Version history" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Finalization review" })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath(`chat-checkpoints-${width}.png`), fullPage: true });
});
