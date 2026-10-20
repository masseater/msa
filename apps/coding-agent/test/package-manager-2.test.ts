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

const shouldAutoDiscoverProjectPromptsWithOverrides = () =>
  runTest(
    Effect.gen(function* () {
      const promptsDir = joinPath(tempDir, ".msa", "prompts");
      yield* makeDirectory(promptsDir);
      const promptPath = joinPath(promptsDir, "is.md");
      yield* writeTextFile(promptPath, "Is prompt");

      settingsManager.resources.setProjectPromptTemplatePaths(["!prompts/is.md"]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.prompts.some((r) => r.path === promptPath && !r.enabled)).toBe(true);
    }),
  );

const shouldResolveDirectoryWithPackageJsonMsa = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "my-extensions-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./extensions/clip.ts", "./extensions/cost.ts"],
          },
          name: "my-extensions-pkg",
        }),
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "clip.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "cost.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(joinPath(pkgDir, "extensions", "helper.ts"), "export const x = 1;");

      settingsManager.resources.setExtensionPaths([pkgDir]);

      const result = yield* awaited(packageManager.resolution.resolve());

      expect(
        result.extensions.some(
          (r) => r.path === joinPath(pkgDir, "extensions", "clip.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        result.extensions.some(
          (r) => r.path === joinPath(pkgDir, "extensions", "cost.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "helper.ts"))).toBe(
        false,
      );
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

  describe("resolve", () => {
    it(
      "should auto-discover project prompts with overrides",
      shouldAutoDiscoverProjectPromptsWithOverrides,
    );

    it(
      "should resolve directory with package.json msa.extensions in extensions setting",
      shouldResolveDirectoryWithPackageJsonMsa,
    );
  });
});
