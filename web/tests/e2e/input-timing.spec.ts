import { expect, test } from "@playwright/test";

import { acknowledge, type InputTiming } from "../helpers/input-timing";

test("pre-input actionability waits do not consume the feedback budget", async ({ page }) => {
  await page.setContent('<button disabled>Respond</button><output aria-label="Feedback"></output>');
  await page.getByRole("button").evaluate((button) => {
    button.addEventListener("click", () => {
      document.querySelector("output")!.textContent = "Ready";
    });
    setTimeout(() => button.removeAttribute("disabled"), 1500);
  });
  const samples: InputTiming[] = [];
  await acknowledge(
    samples,
    "immediate feedback",
    { target: page.getByRole("button") },
    { selector: "output", text: "Ready" },
    () => expect(page.getByLabel("Feedback")).toHaveText("Ready"),
  );
  expect(samples[0].actionabilityMilliseconds).toBeGreaterThan(1000);
  expect(samples[0].milliseconds).toBeLessThanOrEqual(1000);
});

test("assertion overhead does not inflate browser-visible feedback time", async ({ page }) => {
  await page.setContent('<button>Respond</button><output aria-label="Feedback"></output>');
  await page.getByRole("button").evaluate((button) => {
    button.addEventListener("click", () => {
      document.querySelector("output")!.textContent = "Ready";
    });
  });
  const samples: InputTiming[] = [];
  await acknowledge(
    samples,
    "immediate feedback with slow verification",
    { target: page.getByRole("button") },
    { selector: "output", text: "Ready" },
    async () => {
      // Deliberately slow verification tests the timer, not application behaviour.
      await page.waitForTimeout(1200);
      await expect(page.getByLabel("Feedback")).toHaveText("Ready");
    },
  );
  expect(samples[0].milliseconds).toBeLessThanOrEqual(1000);
});

for (const key of [undefined, "Enter"]) {
  test(`slow feedback fails the unchanged budget (${key ?? "click"})`, async ({ page }) => {
    await page.setContent('<button>Respond</button><output aria-label="Feedback"></output>');
    await page.getByRole("button").evaluate((button) => {
      button.addEventListener("click", () => {
        setTimeout(() => {
          document.querySelector("output")!.textContent = "Ready";
        }, 1200);
      });
    });
    const samples: InputTiming[] = [];
    await expect(
      acknowledge(
        samples,
        "slow feedback",
        { target: page.getByRole("button"), key },
        { selector: "output", text: "Ready" },
        () => expect(page.getByLabel("Feedback")).toHaveText("Ready"),
      ),
    ).rejects.toThrow("slow feedback acknowledgement");
    expect(samples).toHaveLength(1);
    expect(samples[0].milliseconds).toBeGreaterThanOrEqual(1200);
  });
}

test("hidden feedback does not stop the timer", async ({ page }) => {
  await page.setContent(
    '<button>Respond</button><output aria-label="Feedback" hidden>Ready</output>',
  );
  await page.getByRole("button").evaluate((button) => {
    button.addEventListener("click", () => {
      setTimeout(() => document.querySelector("output")!.removeAttribute("hidden"), 1200);
    });
  });
  const samples: InputTiming[] = [];
  await expect(
    acknowledge(
      samples,
      "delayed visible feedback",
      { target: page.getByRole("button") },
      { selector: "output", text: "Ready" },
      () => expect(page.getByLabel("Feedback")).toBeVisible(),
    ),
  ).rejects.toThrow("delayed visible feedback acknowledgement");
  expect(samples[0].milliseconds).toBeGreaterThanOrEqual(1200);
});
