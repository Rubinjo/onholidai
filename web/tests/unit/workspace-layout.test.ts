import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const styles = read("app/globals.css");
const workspace = read("components/trip-workspace/workspace.tsx");
const estimateMap = read("components/map/estimate-map.tsx");

describe("final workspace layout", () => {
  it("scrolls the outer panels independently of the middle panel", () => {
    const pane = /\.trip-workspace__pane\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(pane).toMatch(/overflow-y:\s*auto/);
    const details = /\.trip-workspace__pane--details\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    const conversation = /\.trip-workspace__pane--conversation\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(details).toContain("grid-area: details");
    expect(conversation).toContain("grid-area: conversation");
    // The middle panel never scrolls itself; the route list is the only fallback scroll region.
    const route = /\.trip-workspace__pane--route\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(route).toMatch(/overflow:\s*hidden/);
    const list = /\.trip-workspace__route-list\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(list).toMatch(/overflow-y:\s*auto/);
    expect(list).toMatch(/min-height:\s*6rem/);
  });

  it("keeps the map from being squeezed below its own content", () => {
    const fill = /\.map-section--fill\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(fill).toContain("min-height: min-content");
    const canvas = /\.map-section--fill\s+\.map-section__canvas\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(canvas).toMatch(/min-height:\s*8rem/);
    expect(canvas).toMatch(/height:\s*auto/);
  });

  it("owns price and booking in the middle column while keeping them last in the DOM", () => {
    expect(styles).toMatch(/\.trip-price-bar\s*\{[^}]*grid-area:\s*price/);
    expect(styles).toMatch(
      /grid-template-areas:\s*"details route conversation"\s*"details price conversation"/,
    );
    const grid = workspace.slice(workspace.indexOf('className="trip-workspace"'));
    expect(grid.indexOf("<PriceBar")).toBeGreaterThan(grid.indexOf("trip-workspace__pane--conversation"));
    expect(grid.indexOf("<PriceBar")).toBeGreaterThan(grid.indexOf("trip-workspace__pane--route"));
  });

  it("serves the MapLibre worker from a stable URL and loads its stylesheet", () => {
    expect(estimateMap).toContain('import "maplibre-gl/dist/maplibre-gl.css"');
    expect(estimateMap).toContain('setWorkerUrl(workerUrl)');
    expect(estimateMap).toContain('const workerUrl = "/maplibre/maplibre-gl-worker.mjs"');
  });
});
