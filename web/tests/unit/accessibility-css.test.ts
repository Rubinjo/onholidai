import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("application accessibility styles", () => {
  it("keeps keyboard focus visibly distinct", () => {
    expect(styles).toMatch(/:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--focus-ring\)/);
    expect(styles).not.toMatch(/outline:\s*(?:0|none)\s*[;}]/);
  });

  it("disables non-essential motion when requested", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("scroll-behavior: auto !important");
    expect(styles).toContain("animation-duration: 0.01ms !important");
    expect(styles).toContain("animation-iteration-count: 1 !important");
    expect(styles).toContain("transition-duration: 0.01ms !important");
  });
});
