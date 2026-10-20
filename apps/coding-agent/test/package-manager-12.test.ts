import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import packageManagerSupport from "./package-manager-support.ts";
import type packageManagerSupportTypes from "./package-manager-support.types.ts";
const { readEnv } = processEnv;

const { packagePaths } = packageManagerSupport;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  relativePath,
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

const shouldWorkWithDirectPathsNoPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "direct-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "one.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "two.ts"),
        "export default function() {}",
      );

      settingsManager.setPackages([
        {
          extensions: ["extensions/one.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "two.ts"))).toBe(true);
    }),
  );

const shouldResolveAutoloadDisabledProjectPackageEntries = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(agentDir, "npm", "node_modules", "msa-tools");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({ name: "msa-tools", version: "1.0.0" }),
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      settingsManager.setPackages(["npm:msa-tools"]);
      settingsManager.setProjectPackages([
        { autoload: false, extensions: ["-extensions/foo.ts"], source: "npm:msa-tools" },
      ]);
      const runCommandSpy = vi
        .spyOn(
          packageManager as unknown as packageManagerSupportTypes.PackageManagerInternals,
          "runCommand",
        )
        .mockRejectedValue(new Error("unexpected install"));

      const result = yield* awaited(packageManager.resolve());
      const states = Object.fromEntries(
        result.extensions.map((resource) => [
          resource.path,
          { enabled: resource.enabled, scope: resource.metadata.scope },
        ]),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
      expect(states[joinPath(pkgDir, "extensions", "foo.ts")]).toEqual({
        enabled: false,
        scope: "project",
      });
      expect(states[joinPath(pkgDir, "extensions", "bar.ts")]).toEqual({
        enabled: true,
        scope: "user",
      });
    }),
  );

const shouldResolveAutoloadDisabledPackageEntriesAs = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("HOME", tempDir);
      const pkgDir = joinPath(tempDir, "positive-only-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "skills", "foo"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(joinPath(pkgDir, "skills", "foo", "SKILL.md"), "# Foo\n");
      settingsManager.setProjectPackages([
        {
          autoload: false,
          extensions: ["+extensions/foo.ts"],
          source: relativePath(joinPath(tempDir, ".msa"), pkgDir),
        },
      ]);

      const result = yield* awaited(packageManager.resolve());

      expect(result.extensions.map((resource) => resource.path)).toEqual([
        joinPath(pkgDir, "extensions", "foo.ts"),
      ]);
      expect(result.skills).toEqual([]);
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

  describe("pattern filtering in package filters", () => {
    it("should work with direct paths (no patterns)", shouldWorkWithDirectPathsNoPatterns);

    it(
      "should resolve autoload-disabled project package entries as deltas over global packages",
      shouldResolveAutoloadDisabledProjectPackageEntries,
    );

    it(
      "should resolve autoload-disabled package entries as positive-only without a global package",
      shouldResolveAutoloadDisabledPackageEntriesAs,
    );
  });
});
