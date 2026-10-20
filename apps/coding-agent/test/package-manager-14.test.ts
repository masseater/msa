import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import packageManagerSupport from "./package-manager-support.ts";
const { readEnv } = processEnv;

const { packagePaths } = packageManagerSupport;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldOnlyLoadIndexTsFromSubdirectories = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "multifile-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "subagent"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "subagent", "index.ts"),
        `import { helper } from "./agents.ts";
export default function(api) { api.registerTool({ name: "test", description: "test", execute: async () => helper() }); }`,
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "subagent", "agents.ts"),
        `export function helper() { return "helper"; }`,
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "standalone.ts"),
        "export default function(api) {}",
      );

      const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));

      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "subagent/index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "standalone.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "agents.ts"))).toBe(
        false,
      );
    }),
  );

const shouldRespectPackageJsonMsaExtensionsManifest = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "manifest-subdir-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "custom"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "custom", "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./main.ts"],
          },
        }),
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "custom", "main.ts"),
        "export default function(api) {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "custom", "utils.ts"),
        "export const util = 1;",
      );

      const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));

      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "custom/main.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "utils.ts"))).toBe(
        false,
      );
    }),
  );

const shouldHandleMixedTopLevelFilesAnd = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "mixed-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "complex"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "simple.ts"),
        "export default function(api) {}",
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "complex", "index.ts"),
        "import { a } from './a.ts'; export default function(api) {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "complex", "a.ts"),
        "export const a = 1;",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "complex", "b.ts"),
        "export const b = 2;",
      );

      const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));

      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "simple.ts") && r.enabled),
      ).toBe(true);
      expect(
        result.extensions.some(
          (r) => packagePaths.pathEndsWith(r.path, "complex/index.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "complex/a.ts"))).toBe(
        false,
      );
      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "complex/b.ts"))).toBe(
        false,
      );

      expect(result.extensions.filter((r) => r.enabled).length).toBe(2);
    }),
  );

const shouldSkipSubdirectoriesWithoutIndexTsOr = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "no-entry-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions", "broken"));

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "broken", "helper.ts"),
        "export const x = 1;",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "broken", "another.ts"),
        "export const y = 2;",
      );

      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "valid.ts"),
        "export default function(api) {}",
      );

      const result = yield* awaited(packageManager.resolveExtensionSources([pkgDir]));

      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "valid.ts") && r.enabled),
      ).toBe(true);
      expect(result.extensions.filter((r) => r.enabled).length).toBe(1);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      previousOfflineEnv = readEnv("MSA_OFFLINE");
      vi.stubEnv("MSA_OFFLINE", undefined);
      tempDir = yield* makeTempDir("pm-test-");
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(agentDir);

      settingsManager = SettingsManager.inMemory();
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });
    }),
  );

const afterEachHook = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("multi-file extension discovery (issue #1102)", () => {
    it(
      "should only load index.ts from subdirectories, not helper modules",
      shouldOnlyLoadIndexTsFromSubdirectories,
    );

    it(
      "should respect package.json msa.extensions manifest in subdirectories",
      shouldRespectPackageJsonMsaExtensionsManifest,
    );

    it("should handle mixed top-level files and subdirectories", shouldHandleMixedTopLevelFilesAnd);

    it(
      "should skip subdirectories without index.ts or manifest",
      shouldSkipSubdirectoriesWithoutIndexTsOr,
    );
  });
});
