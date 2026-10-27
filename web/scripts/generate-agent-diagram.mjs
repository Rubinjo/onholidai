import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = resolve(root, "docs/agent-architecture.mmd");
const outputPath = resolve(root, "docs/agent-architecture.svg");
const source = await readFile(sourcePath, "utf8");
const logos = new Map();
for (const match of source.matchAll(/img:\s*"([^"]+)"/g)) {
  const logo = (await readFile(resolve(dirname(sourcePath), match[1]), "utf8")).replace(
    "var(--purple-200)",
    "#000000",
  );
  logos.set(match[1], `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`);
}
const input = source.replace(/img:\s*"([^"]+)"/g, (_, name) => `img: "${logos.get(name)}"`);
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "onholidai-diagram-"));
let browser;
try {
  await writeFile(resolve(temporaryDirectory, "input.mmd"), input);
  await writeFile(
    resolve(temporaryDirectory, "puppeteer.json"),
    JSON.stringify({ executablePath: chromium.executablePath() }),
  );
  execSync(
    "npx --yes --package @mermaid-js/mermaid-cli@12.0.0 mmdc --input input.mmd --output output.svg --backgroundColor transparent --puppeteerConfigFile puppeteer.json",
    {
      cwd: temporaryDirectory,
      stdio: "inherit",
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "true" },
    },
  );
  const rendered = await readFile(resolve(temporaryDirectory, "output.svg"), "utf8");
  browser = await chromium.launch();
  const page = await browser.newPage();
  const embedded = await page.evaluate((rendered) => {
    const parser = new DOMParser();
    const diagram = parser.parseFromString(rendered, "image/svg+xml").documentElement;
    if (diagram.localName !== "svg" || diagram.querySelector("parsererror")) {
      throw new Error("Mermaid did not produce a valid SVG.");
    }
    const agent = diagram.querySelector('g.image-shape[id*="-flowchart-Agent-"]');
    if (!agent) throw new Error("The diagram is missing its OnHolidai agent node.");
    // Mermaid image nodes omit custom classes, so restore the agent's styling hook.
    agent.classList.add("agent");
    const images = [...diagram.querySelectorAll("image")];
    if (images.length !== 8) throw new Error(`Expected eight logos, found ${images.length}.`);
    images.forEach((image, index) => {
      const href = image.getAttribute("href") ?? image.getAttribute("xlink:href");
      if (!href?.startsWith("data:image/svg+xml;base64,")) {
        throw new Error("Every diagram logo must be an embedded SVG.");
      }
      const text = new TextDecoder().decode(
        Uint8Array.from(atob(href.split(",")[1]), (character) => character.charCodeAt(0)),
      );
      const logo = parser.parseFromString(text, "image/svg+xml").documentElement;
      if (logo.localName !== "svg" || logo.querySelector("parsererror")) {
        throw new Error("A logo is not a valid SVG.");
      }
      document.body.replaceChildren(logo);
      const elements = [logo, ...logo.querySelectorAll("*")];
      // Bake standalone paints before embedding so Mermaid CSS cannot recolor the logos.
      const paints = elements.map((element) => {
        const computed = getComputedStyle(element);
        return [
          "fill",
          "stroke",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
          "stroke-miterlimit",
          "fill-rule",
          "clip-rule",
          "opacity",
          "font-family",
          "font-size",
          "font-weight",
          "font-style",
          "letter-spacing",
        ].map((property) => [property, computed.getPropertyValue(property)]);
      });
      elements.forEach((element, index) => {
        if (element instanceof SVGElement) {
          for (const [property, value] of paints[index]) element.style.setProperty(property, value);
        }
      });
      logo.querySelectorAll("style").forEach((style) => style.remove());
      const ids = new Map(
        elements
          .filter((element) => element.id)
          .map((element) => [element.id, `logo-${index}-${element.id}`]),
      );
      elements.forEach((element) => {
        for (const attribute of [...element.attributes]) {
          let value = attribute.value;
          value = value.replace(
            /url\((["']?)#([^)"']+)\1\)/g,
            (_, quote, id) => `url(#${ids.get(id) ?? id})`,
          );
          for (const [oldId, newId] of ids) {
            if (value === `#${oldId}`) value = `#${newId}`;
          }
          if (attribute.name === "id") value = ids.get(value) ?? value;
          if (attribute.name === "aria-labelledby") {
            value = value
              .split(/\s+/)
              .map((id) => ids.get(id) ?? id)
              .join(" ");
          }
          element.setAttribute(attribute.name, value);
        }
      });
      for (const attribute of ["x", "y", "width", "height", "transform"]) {
        const value = image.getAttribute(attribute);
        if (value !== null) logo.setAttribute(attribute, value);
      }
      logo.setAttribute("class", "embedded-logo");
      logo.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const frame = image.closest("g.image-shape");
      if (!frame) throw new Error("A logo is missing its Mermaid image node.");
      if (!frame.classList.contains("agent")) {
        frame.querySelectorAll("path").forEach((path) => path.remove());
      }
      image.replaceWith(logo);
    });
    const namespace = "http://www.w3.org/2000/svg";
    const title = document.createElementNS(namespace, "title");
    title.id = "architecture-title";
    title.textContent = "OnHolidai trip-planning agent";
    const description = document.createElementNS(namespace, "desc");
    description.id = "architecture-description";
    description.textContent =
      "The agent uses Nebius Token Factory with NVIDIA Nemotron models, Google Maps Grounding Lite MCP, Tavily search, and an application-owned supplier gateway connecting Duffel flights, Nuitee accommodation, and Viator activities. Trips have saved versions and a separate booking review.";
    diagram.prepend(title, description);
    diagram.setAttribute("role", "img");
    diagram.setAttribute("aria-labelledby", title.id);
    diagram.setAttribute("aria-describedby", description.id);
    if (diagram.querySelector("image, foreignObject, script")) {
      throw new Error("The diagram must contain only native SVG artwork and labels.");
    }
    return new XMLSerializer().serializeToString(diagram);
  }, rendered);
  await writeFile(outputPath, `${embedded}\n`);
  console.log("Generated docs/agent-architecture.svg with eight inline vector logos.");
} finally {
  await browser?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
