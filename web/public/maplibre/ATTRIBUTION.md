## Vendored MapLibre worker

`maplibre-gl-worker.mjs` is the unmodified worker bundle copied from the
`maplibre-gl` npm package so the browser can load it from a stable, same-origin
URL (`/maplibre/maplibre-gl-worker.mjs`).

MapLibre derives its default worker URL from `import.meta.url`, expecting the
worker file to sit next to the loaded module. Under a bundled chunk layout that
URL does not exist, and the map fails with `Worker failed to load. Check that
the worker URL is correct.` The application therefore calls
`setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")` before creating a map.

- Package: `maplibre-gl`
- Version: `6.13.0` (must match `web/package.json`; re-copy on upgrade)
- Source file: `maplibre-gl/dist/maplibre-gl-worker.mjs`
- SHA-256: `53a2dd60f76c7b9201a3cc007b755d98ce4b52403843fef5c90c41780fe62e91`
- License: BSD-3-Clause, full text in `LICENSE.txt`

The worker bundle has no imports and is served as a module worker.
