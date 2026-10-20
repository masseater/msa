import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
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

const shouldKeepMsaManifestEntriesWithLeading = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "tilde-manifest-package");
      const directExtensionPath = joinPath(pkgDir, "~extensions", "main.ts");
      const slashExtensionPath = joinPath(pkgDir, "~", "extensions", "alt.ts");
      const directSkillPath = joinPath(pkgDir, "~skills", "direct-skill", "SKILL.md");
      const slashSkillPath = joinPath(pkgDir, "~", "skills", "slash-skill", "SKILL.md");

      yield* makeDirectory(joinPath(pkgDir, "~extensions"));
      yield* makeDirectory(joinPath(pkgDir, "~", "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "~skills", "direct-skill"));
      yield* makeDirectory(joinPath(pkgDir, "~", "skills", "slash-skill"));
      yield* writeTextFile(directExtensionPath, "export default function() {}");
      yield* writeTextFile(slashExtensionPath, "export default function() {}");
      yield* writeTextFile(
        directSkillPath,
        "---\nname: direct-skill\ndescription: Direct\n---\nContent",
      );
      yield* writeTextFile(
        slashSkillPath,
        "---\nname: slash-skill\ndescription: Slash\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["~extensions/main.ts", "~/extensions/alt.ts"],
            skills: ["~skills", "~/skills"],
          },
          name: "tilde-manifest-package",
        }),
      );

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([pkgDir]));

      expect(result.extensions.some((r) => r.path === directExtensionPath && r.enabled)).toBe(true);
      expect(result.extensions.some((r) => r.path === slashExtensionPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === directSkillPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === slashSkillPath && r.enabled)).toBe(true);
    }),
  );

const shouldHandleDirectoriesWithAutoDiscoveryLayout = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "auto-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "themes"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "main.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(joinPath(pkgDir, "themes", "dark.json"), "{}");

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([pkgDir]));
      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "main.ts") && r.enabled),
      ).toBe(true);
      expect(
        result.themes.some((r) => packagePaths.pathEndsWith(r.path, "dark.json") && r.enabled),
      ).toBe(true);
    }),
  );

const shouldStopRecursingWhenAPackageSkill = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "skill-root-pkg");
      yield* makeDirectory(joinPath(pkgDir, "skills", "root-skill", "nested-skill"));
      const rootSkill = joinPath(pkgDir, "skills", "root-skill", "SKILL.md");
      const nestedSkill = joinPath(pkgDir, "skills", "root-skill", "nested-skill", "SKILL.md");
      yield* writeTextFile(rootSkill, "---\nname: root-skill\ndescription: Root skill\n---\n");
      yield* writeTextFile(
        nestedSkill,
        "---\nname: nested-skill\ndescription: Nested skill\n---\n",
      );

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([pkgDir]));
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedSkill)).toBe(false);
    }),
  );

const shouldEmitProgressEvents = () =>
  runTest(
    Effect.gen(function* () {
      const events: packageManagerTypes.ProgressEvent[] = [];
      packageManager.progress.setProgressCallback((event) => events.push(event));

      const extPath = joinPath(tempDir, "ext.ts");
      yield* writeTextFile(extPath, "export default function() {}");

      yield* awaited(packageManager.resolution.resolveExtensionSources([extPath]));

      expect(events.length).toBe(0);
    }),
  );

const shouldPreserveArgvEntriesContainingSpaces = () => {
  const valueWithSpace = "C:\\Users\\A B\\.msa\\npm";
  const output = commandRunner.runCommandSync(process.execPath, [
    "-e",
    "console.log(process.argv[1])",
    valueWithSpace,
  ]);

  expect(output).toBe(valueWithSpace);
};

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

  describe("resolveExtensionSources", () => {
    it(
      "should keep msa manifest entries with leading tilde package-relative",
      shouldKeepMsaManifestEntriesWithLeading,
    );

    it(
      "should handle directories with auto-discovery layout",
      shouldHandleDirectoriesWithAutoDiscoveryLayout,
    );

    it(
      "should stop recursing when a package skill directory contains SKILL.md",
      shouldStopRecursingWhenAPackageSkill,
    );
  });
});

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("progress callback", () => {
    it("should emit progress events", shouldEmitProgressEvents);
  });

  describe("command spawning", () => {
    it("should preserve argv entries containing spaces", shouldPreserveArgvEntriesContainingSpaces);
  });
});
