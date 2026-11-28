import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import platform from "../src/core/platform/index.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { writeSkill } = packageManagerSupport;

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();
const { readEnv } = platform;

const { awaited, joinPath, makeDirectory, runTest } = testing;

const shouldUseTheAgentDirAsBasedir = () =>
  runTest(
    Effect.gen(function* () {
      const skillPath = joinPath(fixture.agentDir, "skills", "user-msa", "SKILL.md");
      yield* writeSkill(skillPath, "user-msa", "user msa", "");

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      const skill = result.skills.find((r) => r.path === skillPath);

      expect(skill?.metadata.source).toBe("auto");
      expect(skill?.metadata.scope).toBe("user");
      expect(skill?.metadata.baseDir).toBe(fixture.agentDir);
    }),
  );

const shouldUseTheProjectMsaDirAs = () =>
  runTest(
    Effect.gen(function* () {
      const projectBaseDir = joinPath(fixture.tempDir, ".msa");
      const skillPath = joinPath(projectBaseDir, "skills", "project-msa", "SKILL.md");
      yield* writeSkill(skillPath, "project-msa", "project msa", "");

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      const skill = result.skills.find((r) => r.path === skillPath);

      expect(skill?.metadata.source).toBe("auto");
      expect(skill?.metadata.scope).toBe("project");
      expect(skill?.metadata.baseDir).toBe(projectBaseDir);
    }),
  );

const shouldUseAgentsAsBasedirForUser = () =>
  runTest(
    Effect.gen(function* () {
      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", fixture.tempDir);

      try {
        const agentsBaseDir = joinPath(fixture.tempDir, ".agents");
        const skillPath = joinPath(agentsBaseDir, "skills", "user-agents", "SKILL.md");
        yield* writeSkill(skillPath, "user-agents", "user agents", "");

        const result = yield* awaited(fixture.packageManager.resolution.resolve());
        const skill = result.skills.find((r) => r.path === skillPath);

        expect(skill?.metadata.source).toBe("auto");
        expect(skill?.metadata.scope).toBe("user");
        expect(skill?.metadata.baseDir).toBe(agentsBaseDir);
      } finally {
        if (previousHome === undefined) {
          vi.stubEnv("HOME", undefined);
        } else {
          vi.stubEnv("HOME", previousHome);
        }
      }
    }),
  );

const shouldUseEachProjectAgentsDirAs = () =>
  runTest(
    Effect.gen(function* () {
      const repoRoot = joinPath(fixture.tempDir, "repo");
      const nestedCwd = joinPath(repoRoot, "packages", "feature");
      yield* makeDirectory(nestedCwd);
      yield* makeDirectory(joinPath(repoRoot, ".git"));

      const repoAgentsBaseDir = joinPath(repoRoot, ".agents");
      const repoSkill = joinPath(repoAgentsBaseDir, "skills", "repo", "SKILL.md");
      yield* writeSkill(repoSkill, "repo", "repo", "");

      const packageAgentsBaseDir = joinPath(repoRoot, "packages", ".agents");
      const packageSkill = joinPath(packageAgentsBaseDir, "skills", "package", "SKILL.md");
      yield* writeSkill(packageSkill, "package", "package", "");

      const pm = new DefaultPackageManager({
        agentDir: fixture.agentDir,
        cwd: nestedCwd,
        settingsManager: fixture.settingsManager,
      });

      const result = yield* awaited(pm.resolution.resolve());
      const resolvedRepoSkill = result.skills.find((r) => r.path === repoSkill);
      const resolvedPackageSkill = result.skills.find((r) => r.path === packageSkill);

      expect(resolvedRepoSkill?.metadata.source).toBe("auto");
      expect(resolvedRepoSkill?.metadata.scope).toBe("project");
      expect(resolvedRepoSkill?.metadata.baseDir).toBe(repoAgentsBaseDir);
      expect(resolvedPackageSkill?.metadata.source).toBe("auto");
      expect(resolvedPackageSkill?.metadata.scope).toBe("project");
      expect(resolvedPackageSkill?.metadata.baseDir).toBe(packageAgentsBaseDir);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("auto-discovered skill metadata", () => {
    it(
      "should use the agent dir as baseDir for user .msa/agent skills",
      shouldUseTheAgentDirAsBasedir,
    );

    it(
      "should use the project .msa dir as baseDir for project .msa skills",
      shouldUseTheProjectMsaDirAs,
    );

    it("should use ~/.agents as baseDir for user .agents skills", shouldUseAgentsAsBasedirForUser);

    it(
      "should use each project .agents dir as baseDir for project .agents skills",
      shouldUseEachProjectAgentsDirAs,
    );
  });
});
