import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

// --import preloads a module; register installs its exported loader hooks.
// The URL marker avoids recursively registering when Node loads the hook worker.
if (!import.meta.url.includes("?hooks"))
  register(new URL("./alias-loader.mjs?hooks", import.meta.url));

// Node's native TypeScript stripping does not read tsconfig path aliases.
// Keep the standalone worker entry compatible with the application's @/* alias.
export async function resolveBookingModule(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = resolvePath(process.cwd(), specifier.slice(2));
    for (const target of [base, `${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
      if (existsSync(target) && statSync(target).isFile())
        return nextResolve(pathToFileURL(target).href, context);
    }
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}

export { resolveBookingModule as resolve };
