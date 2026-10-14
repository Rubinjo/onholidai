import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node's native TypeScript stripping does not read tsconfig path aliases.
// Keep the standalone worker entry compatible with the application's @/* alias.
export async function resolveBookingModule(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = resolvePath(process.cwd(), `${specifier.slice(2)}.ts`);
    return nextResolve(pathToFileURL(target).href, context);
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
