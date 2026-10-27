import { expect, test, type Locator } from "@playwright/test";

export type InputTiming = {
  action: string;
  milliseconds: number;
  actionabilityMilliseconds: number;
};
type Feedback = {
  selector: string;
  text?: string;
  value?: string;
};
// Browser-side timestamps exclude pre-input waits and post-feedback tracing or
// assertion polling from the application's feedback budget.
export async function acknowledge(
  samples: InputTiming[],
  action: string,
  input: { target: Locator; key?: string },
  feedback: Feedback,
  outcome: () => Promise<unknown>,
) {
  const measurement = await input.target.evaluateHandle(
    (element, { key, feedback }) => {
      const type = key ? "keydown" : "click";
      let frame = 0;
      let previousFrameMatched = false;
      const state = {
        armed: performance.now(),
        started: null as number | null,
        finished: null as number | null,
        stop: () => {
          element.removeEventListener(type, record, true);
          cancelAnimationFrame(frame);
        },
      };
      function matches() {
        const nodes = [...document.querySelectorAll(feedback.selector)];
        return nodes.some((node) => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return (
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            (feedback.text === undefined || node.textContent?.includes(feedback.text)) &&
            (feedback.value === undefined ||
              (node instanceof HTMLInputElement && node.value === feedback.value))
          );
        });
      }
      function observe() {
        const matched = matches();
        // Require feedback across a paint opportunity, not just a transient DOM mutation.
        if (matched && previousFrameMatched) {
          state.finished = performance.now();
          return;
        }
        previousFrameMatched = matched;
        frame = requestAnimationFrame(observe);
      }
      function record(event: Event) {
        if (
          state.started !== null ||
          !event.isTrusted ||
          (key && (event as KeyboardEvent).key !== key)
        )
          return;
        state.started = event.timeStamp;
        frame = requestAnimationFrame(observe);
      }
      if (matches()) throw new Error("Timing feedback must not already be present before input");
      element.addEventListener(type, record, true);
      return state;
    },
    { key: input.key, feedback },
  );
  try {
    if (input.key) await input.target.press(input.key);
    else await input.target.click();
    await outcome();
    const finished = await input.target
      .page()
      .waitForFunction((state) => state.finished !== null, measurement, { timeout: 5000 });
    await finished.dispose();
    const timing = await measurement.evaluate((state) => {
      if (state.started === null || state.finished === null)
        throw new Error("No matching native input and painted feedback were recorded");
      return {
        milliseconds: state.finished - state.started,
        actionabilityMilliseconds: state.started - state.armed,
      };
    });
    const sample = { action, ...timing };
    samples.push(sample);
    await test.info().attach(`input-timing-${action.replaceAll(" ", "-")}.json`, {
      body: JSON.stringify(sample),
      contentType: "application/json",
    });
    expect(timing.milliseconds, `${action} acknowledgement`).toBeLessThanOrEqual(1000);
  } finally {
    await measurement.evaluate((state) => state.stop());
    await measurement.dispose();
  }
}
