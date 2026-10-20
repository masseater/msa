import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let agentDir: string;

let settingsManager: SettingsManager;

let packageManager: DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldUseTheAgentDirAsBasedir = () =>
  runTest(
    Effect.gen(function* () {
      const skillPath = joinPath(agentDir, "skills", "user-msa", "SKILL.md");
      yield* makeDirectory(joinPath(agentDir, "skills", "user-msa"));
      yield* writeTextFile(skillPath, "---\nname: user-msa\ndescription: user msa\n---\n");

      const result = yield* awaited(packageManager.resolve());
      const skill = result.skills.find((r) => r.path === skillPath);

      expect(skill?.metadata.source).toBe("auto");
      expect(skill?.metadata.scope).toBe("user");
      expect(skill?.metadata.baseDir).toBe(agentDir);
    }),
  );

const shouldUseTheProjectMsaDirAs = () =>
  runTest(
    Effect.gen(function* () {
      const projectBaseDir = joinPath(tempDir, ".msa");
      const skillPath = joinPath(projectBaseDir, "skills", "project-msa", "SKILL.md");
      yield* makeDirectory(joinPath(projectBaseDir, "skills", "project-msa"));
      yield* writeTextFile(skillPath, "---\nname: project-msa\ndescription: project msa\n---\n");

      const result = yield* awaited(packageManager.resolve());
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
      vi.stubEnv("HOME", tempDir);

      try {
        const agentsBaseDir = joinPath(tempDir, ".agents");
        const skillPath = joinPath(agentsBaseDir, "skills", "user-agents", "SKILL.md");
        yield* makeDirectory(joinPath(agentsBaseDir, "skills", "user-agents"));
        yield* writeTextFile(skillPath, "---\nname: user-agents\ndescription: user agents\n---\n");

        const result = yield* awaited(packageManager.resolve());
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
      const repoRoot = joinPath(tempDir, "repo");
      const nestedCwd = joinPath(repoRoot, "packages", "feature");
      yield* makeDirectory(nestedCwd);
      yield* makeDirectory(joinPath(repoRoot, ".git"));

      const repoAgentsBaseDir = joinPath(repoRoot, ".agents");
      const repoSkill = joinPath(repoAgentsBaseDir, "skills", "repo", "SKILL.md");
      yield* makeDirectory(joinPath(repoAgentsBaseDir, "skills", "repo"));
      yield* writeTextFile(repoSkill, "---\nname: repo\ndescription: repo\n---\n");

      const packageAgentsBaseDir = joinPath(repoRoot, "packages", ".agents");
      const packageSkill = joinPath(packageAgentsBaseDir, "skills", "package", "SKILL.md");
      yield* makeDirectory(joinPath(packageAgentsBaseDir, "skills", "package"));
      yield* writeTextFile(packageSkill, "---\nname: package\ndescription: package\n---\n");

      const pm = new DefaultPackageManager({
        agentDir,
        cwd: nestedCwd,
        settingsManager,
      });

      const result = yield* awaited(pm.resolve());
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

const beforeEachHook2 = () =>
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

const afterEachHook2 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

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
