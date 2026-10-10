import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

/** Resolves extensionless relative imports to .ts for Node strip-types runners. */
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[cm]?[jt]sx?$/.test(specifier)
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const baseDir = path.dirname(parentPath);
    const candidates = [
      path.resolve(baseDir, `${specifier}.ts`),
      path.resolve(baseDir, `${specifier}.tsx`),
      path.resolve(baseDir, specifier, "index.ts"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return {
          shortCircuit: true,
          url: pathToFileURL(candidate).href,
        };
      }
    }
  }
  return nextResolve(specifier, context);
}
