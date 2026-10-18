import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { packagePaths } from "./package-manager-support.ts";
import { Effect } from "effect";
import { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, toJsonText, writeTextFile } from "@msa/testing";
import { readEnv } from "../src/core/process-env.ts";

describe("DefaultPackageManager", () => {
  let tempDir: string;

  let agentDir: string;

  let settingsManager: SettingsManager;

  let packageManager: DefaultPackageManager;

  let previousOfflineEnv: string | undefined;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        previousOfflineEnv = readEnv("MSA_OFFLINE");
        vi.stubEnv("MSA_OFFLINE", undefined);
        tempDir = yield* makeTempDir("pm-test-");
        agentDir = joinPath(tempDir, "agent");
        yield* makeDirectory(agentDir);

        settingsManager = SettingsManager.inMemory();
        packageManager = new DefaultPackageManager({
          cwd: tempDir,
          agentDir,
          settingsManager,
        });
      }),
    ),
  );

  afterEach(() => {
    vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    return runTest(removePath(tempDir));
  });

  describe("resolve", () => {
    it("should auto-discover project prompts with overrides", () => runTest(
Effect.gen(function* () {

      const promptsDir = joinPath(tempDir, ".msa", "prompts");
      (yield* makeDirectory(promptsDir));
      const promptPath = joinPath(promptsDir, "is.md");
      (yield* writeTextFile(promptPath, "Is prompt"));

      settingsManager.setProjectPromptTemplatePaths(["!prompts/is.md"]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.prompts.some((r) => r.path === promptPath && !r.enabled)).toBe(true);
    
}),
));

    it("should resolve directory with package.json msa.extensions in extensions setting", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "my-extensions-pkg");
      (yield* makeDirectory(joinPath(pkgDir, "extensions")));
      (yield* writeTextFile(joinPath(pkgDir, "package.json"), (yield* toJsonText({
          name: "my-extensions-pkg",
          msa: {
            extensions: ["./extensions/clip.ts", "./extensions/cost.ts"],
          },
        }))));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "clip.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "cost.ts"), "export default function() {}"));
      (yield* writeTextFile(joinPath(pkgDir, "extensions", "helper.ts"), "export const x = 1;"));

      settingsManager.setExtensionPaths([pkgDir]);

      const result = (yield* awaited(packageManager.resolve()));

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

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "helper.ts"))).toBe(false);
    
}),
));
  });

  describe("auto-discovered skill metadata", () => {
    it("should use the agent dir as baseDir for user .msa/agent skills", () => runTest(
Effect.gen(function* () {

      const skillPath = joinPath(agentDir, "skills", "user-msa", "SKILL.md");
      (yield* makeDirectory(joinPath(agentDir, "skills", "user-msa")));
      (yield* writeTextFile(skillPath, "---\nname: user-msa\ndescription: user msa\n---\n"));

      const result = (yield* awaited(packageManager.resolve()));
      const skill = result.skills.find((r) => r.path === skillPath);

      expect(skill?.metadata.source).toBe("auto");
      expect(skill?.metadata.scope).toBe("user");
      expect(skill?.metadata.baseDir).toBe(agentDir);
    
}),
));

    it("should use the project .msa dir as baseDir for project .msa skills", () => runTest(
Effect.gen(function* () {

      const projectBaseDir = joinPath(tempDir, ".msa");
      const skillPath = joinPath(projectBaseDir, "skills", "project-msa", "SKILL.md");
      (yield* makeDirectory(joinPath(projectBaseDir, "skills", "project-msa")));
      (yield* writeTextFile(skillPath, "---\nname: project-msa\ndescription: project msa\n---\n"));

      const result = (yield* awaited(packageManager.resolve()));
      const skill = result.skills.find((r) => r.path === skillPath);

      expect(skill?.metadata.source).toBe("auto");
      expect(skill?.metadata.scope).toBe("project");
      expect(skill?.metadata.baseDir).toBe(projectBaseDir);
    
}),
));

    it("should use ~/.agents as baseDir for user .agents skills", () => runTest(
Effect.gen(function* () {

      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", tempDir);

      try {
        const agentsBaseDir = joinPath(tempDir, ".agents");
        const skillPath = joinPath(agentsBaseDir, "skills", "user-agents", "SKILL.md");
        (yield* makeDirectory(joinPath(agentsBaseDir, "skills", "user-agents")));
        (yield* writeTextFile(skillPath, "---\nname: user-agents\ndescription: user agents\n---\n"));

        const result = (yield* awaited(packageManager.resolve()));
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
));

    it("should use each project .agents dir as baseDir for project .agents skills", () => runTest(
Effect.gen(function* () {

      const repoRoot = joinPath(tempDir, "repo");
      const nestedCwd = joinPath(repoRoot, "packages", "feature");
      (yield* makeDirectory(nestedCwd));
      (yield* makeDirectory(joinPath(repoRoot, ".git")));

      const repoAgentsBaseDir = joinPath(repoRoot, ".agents");
      const repoSkill = joinPath(repoAgentsBaseDir, "skills", "repo", "SKILL.md");
      (yield* makeDirectory(joinPath(repoAgentsBaseDir, "skills", "repo")));
      (yield* writeTextFile(repoSkill, "---\nname: repo\ndescription: repo\n---\n"));

      const packageAgentsBaseDir = joinPath(repoRoot, "packages", ".agents");
      const packageSkill = joinPath(packageAgentsBaseDir, "skills", "package", "SKILL.md");
      (yield* makeDirectory(joinPath(packageAgentsBaseDir, "skills", "package")));
      (yield* writeTextFile(packageSkill, "---\nname: package\ndescription: package\n---\n"));

      const pm = new DefaultPackageManager({
        cwd: nestedCwd,
        agentDir,
        settingsManager,
      });

      const result = (yield* awaited(pm.resolve()));
      const resolvedRepoSkill = result.skills.find((r) => r.path === repoSkill);
      const resolvedPackageSkill = result.skills.find((r) => r.path === packageSkill);

      expect(resolvedRepoSkill?.metadata.source).toBe("auto");
      expect(resolvedRepoSkill?.metadata.scope).toBe("project");
      expect(resolvedRepoSkill?.metadata.baseDir).toBe(repoAgentsBaseDir);
      expect(resolvedPackageSkill?.metadata.source).toBe("auto");
      expect(resolvedPackageSkill?.metadata.scope).toBe("project");
      expect(resolvedPackageSkill?.metadata.baseDir).toBe(packageAgentsBaseDir);
    
}),
));
  });

  describe(".agents/skills auto-discovery", () => {
    it("should scan .agents/skills from cwd up to git repo root", () => runTest(
Effect.gen(function* () {

      const repoRoot = joinPath(tempDir, "repo");
      const nestedCwd = joinPath(repoRoot, "packages", "feature");
      (yield* makeDirectory(nestedCwd));
      (yield* makeDirectory(joinPath(repoRoot, ".git")));

      const aboveRepoSkill = joinPath(tempDir, ".agents", "skills", "above-repo", "SKILL.md");
      (yield* makeDirectory(joinPath(tempDir, ".agents", "skills", "above-repo")));
      (yield* writeTextFile(aboveRepoSkill, "---\nname: above-repo\ndescription: above\n---\n"));

      const repoRootSkill = joinPath(repoRoot, ".agents", "skills", "repo-root", "SKILL.md");
      (yield* makeDirectory(joinPath(repoRoot, ".agents", "skills", "repo-root")));
      (yield* writeTextFile(repoRootSkill, "---\nname: repo-root\ndescription: repo\n---\n"));

      const nestedSkill = joinPath(repoRoot, "packages", ".agents", "skills", "nested", "SKILL.md");
      (yield* makeDirectory(joinPath(repoRoot, "packages", ".agents", "skills", "nested")));
      (yield* writeTextFile(nestedSkill, "---\nname: nested\ndescription: nested\n---\n"));

      const pm = new DefaultPackageManager({
        cwd: nestedCwd,
        agentDir,
        settingsManager,
      });

      const result = (yield* awaited(pm.resolve()));
      expect(result.skills.some((r) => r.path === repoRootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === aboveRepoSkill)).toBe(false);
    
}),
));

    it("should scan .agents/skills up to filesystem root when not in a git repo", () => runTest(
Effect.gen(function* () {

      const nonRepoRoot = joinPath(tempDir, "non-repo");
      const nestedCwd = joinPath(nonRepoRoot, "a", "b");
      (yield* makeDirectory(nestedCwd));

      const rootSkill = joinPath(nonRepoRoot, ".agents", "skills", "root", "SKILL.md");
      (yield* makeDirectory(joinPath(nonRepoRoot, ".agents", "skills", "root")));
      (yield* writeTextFile(rootSkill, "---\nname: root\ndescription: root\n---\n"));

      const middleSkill = joinPath(nonRepoRoot, "a", ".agents", "skills", "middle", "SKILL.md");
      (yield* makeDirectory(joinPath(nonRepoRoot, "a", ".agents", "skills", "middle")));
      (yield* writeTextFile(middleSkill, "---\nname: middle\ndescription: middle\n---\n"));

      const pm = new DefaultPackageManager({
        cwd: nestedCwd,
        agentDir,
        settingsManager,
      });

      const result = (yield* awaited(pm.resolve()));
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === middleSkill && r.enabled)).toBe(true);
    
}),
));
  });
});
