import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandLink } from "../../components/brand-link";
import { metadata } from "../../app/layout";

describe("site branding", () => {
  it("uses the same stronger sage accent in both SVG assets", () => {
    for (const name of ["main_logo.svg", "main_icon.svg"]) {
      const svg = readFileSync(resolve(process.cwd(), "public", "logo", name), "utf8");
      expect(svg.match(/fill="#78a98f"/g)).toHaveLength(2);
      expect(svg).not.toContain("#dbe9e1");
    }
  });

  it("renders the supplied wordmark as an accessible home link with intrinsic dimensions", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<BrandLink />);
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAccessibleName("OnHolidai home");
    expect(link?.querySelector("img")).toHaveAttribute("src", "/logo/main_logo.svg");
    expect(link?.querySelector("img")).toHaveAttribute("alt", "OnHolidai");
    expect(link?.querySelector("img")).toHaveAttribute("width", "460");
    expect(link?.querySelector("img")).toHaveAttribute("height", "104");
  });

  it("provides global SVG, PNG fallback and Apple touch icons", () => {
    expect(metadata.icons).toEqual({
      icon: [
        { url: "/logo/favicon-32.png", type: "image/png", sizes: "32x32" },
        { url: "/logo/main_icon.svg", type: "image/svg+xml", sizes: "any" },
      ],
      apple: [{ url: "/logo/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    });
    for (const [name, size] of [
      ["favicon-32.png", 32],
      ["apple-touch-icon.png", 180],
    ] as const) {
      const png = readFileSync(resolve(process.cwd(), "public", "logo", name));
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });
});
