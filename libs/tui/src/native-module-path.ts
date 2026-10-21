import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { dual } from "effect/Function";

import type nativeModulePathTypes from "./native-module-path.types.ts";
import platform from "./platform.ts";

const { pathOperations } = platform;

const { dirname, join } = pathOperations;
const moduleRequire = createRequire(import.meta.url);
const TUI_PACKAGE_NAME = "@msa/tui";

const getNativeModuleCandidates: {
  (nativePath: string, options?: nativeModulePathTypes.NativeModuleCandidateOptions): string[];
  (options?: nativeModulePathTypes.NativeModuleCandidateOptions): (nativePath: string) => string[];
} = dual(
  (args) => typeof args[0] === "string",
  (
    nativePath: string,
    options: nativeModulePathTypes.NativeModuleCandidateOptions = {},
  ): string[] => {
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

const nativeModulePath = {
  getNativeModuleCandidates,
};

export default nativeModulePath;
