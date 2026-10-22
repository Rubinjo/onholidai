import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import importX from "eslint-plugin-import-x";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  eslintConfigPrettier,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "import-x": importX },
    rules: {
      "import-x/newline-after-import": ["error", { count: 1 }],
      "import-x/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "object",
            "type",
          ],
          pathGroups: [
            { pattern: "@/**", group: "internal" },
            { pattern: "@contracts/**", group: "internal" },
          ],
          pathGroupsExcludedImportTypes: ["builtin", "type"],
          "newlines-between": "always",
        },
      ],
    },
  },
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "coverage/**",
    "dist/**",
    "build/**",
    "**/*.min.js",
    "playwright-report/**",
    "test-results/**",
    // Served verbatim from /public: includes the vendored, unmodified MapLibre worker bundle.
    "public/**",
  ]),
]);
