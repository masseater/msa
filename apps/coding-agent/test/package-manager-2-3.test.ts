import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { skillOf } = packageManagerSupport;

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, writeTextFile } = testing;

const shouldScanAgentsSkillsFromCwdUp = () =>
  runTest(
    Effect.gen(function* () {
      const repoRoot = joinPath(fixture.tempDir, "repo");
      const nestedCwd = joinPath(repoRoot, "packages", "feature");
      yield* makeDirectory(nestedCwd);
      yield* makeDirectory(joinPath(repoRoot, ".git"));

      const aboveRepoSkill = joinPath(
        fixture.tempDir,
        ".agents",
        "skills",
        "above-repo",
        "SKILL.md",
      );
      yield* makeDirectory(joinPath(fixture.tempDir, ".agents", "skills", "above-repo"));
      yield* writeTextFile(aboveRepoSkill, skillOf("above-repo", "above", ""));

      const repoRootSkill = joinPath(repoRoot, ".agents", "skills", "repo-root", "SKILL.md");
      yield* makeDirectory(joinPath(repoRoot, ".agents", "skills", "repo-root"));
      yield* writeTextFile(repoRootSkill, skillOf("repo-root", "repo", ""));

      const nestedSkill = joinPath(repoRoot, "packages", ".agents", "skills", "nested", "SKILL.md");
      yield* makeDirectory(joinPath(repoRoot, "packages", ".agents", "skills", "nested"));
      yield* writeTextFile(nestedSkill, skillOf("nested", "nested", ""));

      const pm = new DefaultPackageManager({
        agentDir: fixture.agentDir,
        cwd: nestedCwd,
        settingsManager: fixture.settingsManager,
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
      const nonRepoRoot = joinPath(fixture.tempDir, "non-repo");
      const nestedCwd = joinPath(nonRepoRoot, "a", "b");
      yield* makeDirectory(nestedCwd);

      const rootSkill = joinPath(nonRepoRoot, ".agents", "skills", "root", "SKILL.md");
      yield* makeDirectory(joinPath(nonRepoRoot, ".agents", "skills", "root"));
      yield* writeTextFile(rootSkill, skillOf("root", "root", ""));

      const middleSkill = joinPath(nonRepoRoot, "a", ".agents", "skills", "middle", "SKILL.md");
      yield* makeDirectory(joinPath(nonRepoRoot, "a", ".agents", "skills", "middle"));
      yield* writeTextFile(middleSkill, skillOf("middle", "middle", ""));

      const pm = new DefaultPackageManager({
        agentDir: fixture.agentDir,
        cwd: nestedCwd,
        settingsManager: fixture.settingsManager,
      });

      const result = yield* awaited(pm.resolution.resolve());
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === middleSkill && r.enabled)).toBe(true);
    }),
  );

describe("DefaultPackageManager", () => {
  describe(".agents/skills auto-discovery", () => {
    it("should scan .agents/skills from cwd up to git repo root", shouldScanAgentsSkillsFromCwdUp);

    it(
      "should scan .agents/skills up to filesystem root when not in a git repo",
      shouldScanAgentsSkillsUpToFilesystem,
    );
  });
});
