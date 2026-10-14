import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores(["node_modules/**", ".next/**", "coverage/**", "dist/**", "build/**", "**/*.min.js",
    "playwright-report/**", "test-results/**",
    // Served verbatim from /public: includes the vendored, unmodified MapLibre worker bundle.
    "public/**"]),
]);
