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

const shouldSupportGlobPatternsInManifestExtensions = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "manifest-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "node_modules/dep/extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "local.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "node_modules/dep/extensions", "remote.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "node_modules/dep/extensions", "skip.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["extensions", "node_modules/dep/extensions", "!**/skip.ts"],
          },
          name: "manifest-pkg",
        }),
      );

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([pkgDir]));
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "local.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "remote.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "skip.ts"))).toBe(
        false,
      );
    }),
  );

const shouldSupportGlobPatternsInManifestSkills = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "skill-manifest-pkg");
      yield* makeDirectory(joinPath(pkgDir, "skills/good-skill"));
      yield* makeDirectory(joinPath(pkgDir, "skills/bad-skill"));
      yield* writeTextFile(
        joinPath(pkgDir, "skills/good-skill", "SKILL.md"),
        "---\nname: good-skill\ndescription: Good\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "skills/bad-skill", "SKILL.md"),
        "---\nname: bad-skill\ndescription: Bad\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            skills: ["skills", "!**/bad-skill"],
          },
          name: "skill-manifest-pkg",
        }),
      );

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([pkgDir]));
      expect(result.skills.some((r) => packagePaths.isEnabled(r, "good-skill", "includes"))).toBe(
        true,
      );
      expect(result.skills.some((r) => r.path.includes("bad-skill"))).toBe(false);
    }),
  );

const beforeEachHook3 = () =>
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

const afterEachHook3 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook3);

  afterEach(afterEachHook3);

  describe("pattern filtering in msa manifest", () => {
    it(
      "should support glob patterns in manifest extensions",
      shouldSupportGlobPatternsInManifestExtensions,
    );

    it(
      "should support glob patterns in manifest skills",
      shouldSupportGlobPatternsInManifestSkills,
    );
  });
});
