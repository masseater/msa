import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
const { readEnv } = processEnv;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let previousOfflineEnv: string | undefined;

const shouldScanAgentsSkillsFromCwdUp = () =>
  runTest(
    Effect.gen(function* () {
      const repoRoot = joinPath(tempDir, "repo");
      const nestedCwd = joinPath(repoRoot, "packages", "feature");
      yield* makeDirectory(nestedCwd);
      yield* makeDirectory(joinPath(repoRoot, ".git"));

      const aboveRepoSkill = joinPath(tempDir, ".agents", "skills", "above-repo", "SKILL.md");
      yield* makeDirectory(joinPath(tempDir, ".agents", "skills", "above-repo"));
      yield* writeTextFile(aboveRepoSkill, "---\nname: above-repo\ndescription: above\n---\n");

      const repoRootSkill = joinPath(repoRoot, ".agents", "skills", "repo-root", "SKILL.md");
      yield* makeDirectory(joinPath(repoRoot, ".agents", "skills", "repo-root"));
      yield* writeTextFile(repoRootSkill, "---\nname: repo-root\ndescription: repo\n---\n");

      const nestedSkill = joinPath(repoRoot, "packages", ".agents", "skills", "nested", "SKILL.md");
      yield* makeDirectory(joinPath(repoRoot, "packages", ".agents", "skills", "nested"));
      yield* writeTextFile(nestedSkill, "---\nname: nested\ndescription: nested\n---\n");

      const pm = new DefaultPackageManager({
        agentDir,
        cwd: nestedCwd,
        settingsManager,
      });

      const result = yield* awaited(pm.resolution.resolve());
      expect(result.skills.some((r) => r.path === repoRootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === aboveRepoSkill)).toBe(false);
    }),
  );

const shouldScanAgentsSkillsUpToFilesystem = () =>
  runTest(
    Effect.gen(function* () {
      const nonRepoRoot = joinPath(tempDir, "non-repo");
      const nestedCwd = joinPath(nonRepoRoot, "a", "b");
      yield* makeDirectory(nestedCwd);

      const rootSkill = joinPath(nonRepoRoot, ".agents", "skills", "root", "SKILL.md");
      yield* makeDirectory(joinPath(nonRepoRoot, ".agents", "skills", "root"));
      yield* writeTextFile(rootSkill, "---\nname: root\ndescription: root\n---\n");

      const middleSkill = joinPath(nonRepoRoot, "a", ".agents", "skills", "middle", "SKILL.md");
      yield* makeDirectory(joinPath(nonRepoRoot, "a", ".agents", "skills", "middle"));
      yield* writeTextFile(middleSkill, "---\nname: middle\ndescription: middle\n---\n");

      const pm = new DefaultPackageManager({
        agentDir,
        cwd: nestedCwd,
        settingsManager,
      });

      const result = yield* awaited(pm.resolution.resolve());
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === middleSkill && r.enabled)).toBe(true);
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

  describe(".agents/skills auto-discovery", () => {
    it("should scan .agents/skills from cwd up to git repo root", shouldScanAgentsSkillsFromCwdUp);

    it(
      "should scan .agents/skills up to filesystem root when not in a git repo",
      shouldScanAgentsSkillsUpToFilesystem,
    );
  });
});
