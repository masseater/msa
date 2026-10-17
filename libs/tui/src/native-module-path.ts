import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dual } from "effect/Function";

const moduleRequire = createRequire(import.meta.url);
const TUI_PACKAGE_NAME = "@msa/tui";

export interface NativeModuleCandidateOptions {
  moduleUrl?: string;
  execPath?: string;
  resolvePackage?: (specifier: string) => string;
}

export const getNativeModuleCandidates: {
  (nativePath: string, options?: NativeModuleCandidateOptions): string[];
  (options?: NativeModuleCandidateOptions): (nativePath: string) => string[];
} = dual(
  (args) => typeof args[0] === "string",
  (nativePath: string, options: NativeModuleCandidateOptions = {}): string[] => {
    const moduleDir = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url));
    const candidates: string[] = [];

    try {
      const packageEntry = (options.resolvePackage ?? moduleRequire.resolve)(TUI_PACKAGE_NAME);
      candidates.push(join(dirname(packageEntry), "..", nativePath));
    } catch {}

    candidates.push(
      join(moduleDir, "..", nativePath),
      join(moduleDir, nativePath),
      join(dirname(options.execPath ?? process.execPath), nativePath),
    );
    return Array.from(new Set(candidates));
  },
);
