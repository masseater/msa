import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { pathEndsWith } from "./package-manager-support.ts";

describe("DefaultPackageManager", () => {
  let tempDir: string;

  let agentDir: string;

  let settingsManager: SettingsManager;

  let packageManager: DefaultPackageManager;

  let previousOfflineEnv: string | undefined;

  beforeEach(() => {
    previousOfflineEnv = process.env["MSA_OFFLINE"];
    delete process.env["MSA_OFFLINE"];
    tempDir = join(tmpdir(), `pm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    agentDir = join(tempDir, "agent");
    mkdirSync(agentDir, { recursive: true });

    settingsManager = SettingsManager.inMemory();
    packageManager = new DefaultPackageManager({
      cwd: tempDir,
      agentDir,
      settingsManager,
    });
  });

  afterEach(() => {
    if (previousOfflineEnv === undefined) {
      delete process.env["MSA_OFFLINE"];
    } else {
      process.env["MSA_OFFLINE"] = previousOfflineEnv;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("resolve", () => {
    it("should auto-discover project prompts with overrides", async () => {
      const promptsDir = join(tempDir, ".msa", "prompts");
      mkdirSync(promptsDir, { recursive: true });
      const promptPath = join(promptsDir, "is.md");
      writeFileSync(promptPath, "Is prompt");

      settingsManager.setProjectPromptTemplatePaths(["!prompts/is.md"]);

      const result = await packageManager.resolve();
      expect(result.prompts.some((r) => r.path === promptPath && !r.enabled)).toBe(true);
    });

    it("should resolve directory with package.json msa.extensions in extensions setting", async () => {
      const pkgDir = join(tempDir, "my-extensions-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "my-extensions-pkg",
          msa: {
            extensions: ["./extensions/clip.ts", "./extensions/cost.ts"],
          },
        }),
      );
      writeFileSync(join(pkgDir, "extensions", "clip.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "cost.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "extensions", "helper.ts"), "export const x = 1;");

      settingsManager.setExtensionPaths([pkgDir]);

      const result = await packageManager.resolve();

      expect(
        result.extensions.some(
          (r) => r.path === join(pkgDir, "extensions", "clip.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        result.extensions.some(
          (r) => r.path === join(pkgDir, "extensions", "cost.ts") && r.enabled,
        ),
      ).toBe(true);

      expect(result.extensions.some((r) => pathEndsWith(r.path, "helper.ts"))).toBe(false);
    });
  });

  describe("auto-discovered skill metadata", () => {
    it("should use the agent dir as baseDir for user .msa/agent skills", async () => {
      const skillPath = join(agentDir, "skills", "user-msa", "SKILL.md");
      mkdirSync(join(agentDir, "skills", "user-msa"), { recursive: true });
      writeFileSync(skillPath, "---\nname: user-msa\ndescription: user msa\n---\n");

      const result = await packageManager.resolve();
      const skill = result.skills.find((r) => r.path === skillPath);

      expect(skill?.metadata.source).toBe("auto");
      expect(skill?.metadata.scope).toBe("user");
      expect(skill?.metadata.baseDir).toBe(agentDir);
    });

    it("should use the project .msa dir as baseDir for project .msa skills", async () => {
      const projectBaseDir = join(tempDir, ".msa");
      const skillPath = join(projectBaseDir, "skills", "project-msa", "SKILL.md");
      mkdirSync(join(projectBaseDir, "skills", "project-msa"), { recursive: true });
      writeFileSync(skillPath, "---\nname: project-msa\ndescription: project msa\n---\n");

      const result = await packageManager.resolve();
      const skill = result.skills.find((r) => r.path === skillPath);

      expect(skill?.metadata.source).toBe("auto");
      expect(skill?.metadata.scope).toBe("project");
      expect(skill?.metadata.baseDir).toBe(projectBaseDir);
    });

    it("should use ~/.agents as baseDir for user .agents skills", async () => {
      const previousHome = process.env["HOME"];
      process.env["HOME"] = tempDir;

      try {
        const agentsBaseDir = join(tempDir, ".agents");
        const skillPath = join(agentsBaseDir, "skills", "user-agents", "SKILL.md");
        mkdirSync(join(agentsBaseDir, "skills", "user-agents"), { recursive: true });
        writeFileSync(skillPath, "---\nname: user-agents\ndescription: user agents\n---\n");

        const result = await packageManager.resolve();
        const skill = result.skills.find((r) => r.path === skillPath);

        expect(skill?.metadata.source).toBe("auto");
        expect(skill?.metadata.scope).toBe("user");
        expect(skill?.metadata.baseDir).toBe(agentsBaseDir);
      } finally {
        if (previousHome === undefined) {
          delete process.env["HOME"];
        } else {
          process.env["HOME"] = previousHome;
        }
      }
    });

    it("should use each project .agents dir as baseDir for project .agents skills", async () => {
      const repoRoot = join(tempDir, "repo");
      const nestedCwd = join(repoRoot, "packages", "feature");
      mkdirSync(nestedCwd, { recursive: true });
      mkdirSync(join(repoRoot, ".git"), { recursive: true });

      const repoAgentsBaseDir = join(repoRoot, ".agents");
      const repoSkill = join(repoAgentsBaseDir, "skills", "repo", "SKILL.md");
      mkdirSync(join(repoAgentsBaseDir, "skills", "repo"), { recursive: true });
      writeFileSync(repoSkill, "---\nname: repo\ndescription: repo\n---\n");

      const packageAgentsBaseDir = join(repoRoot, "packages", ".agents");
      const packageSkill = join(packageAgentsBaseDir, "skills", "package", "SKILL.md");
      mkdirSync(join(packageAgentsBaseDir, "skills", "package"), { recursive: true });
      writeFileSync(packageSkill, "---\nname: package\ndescription: package\n---\n");

      const pm = new DefaultPackageManager({
        cwd: nestedCwd,
        agentDir,
        settingsManager,
      });

      const result = await pm.resolve();
      const resolvedRepoSkill = result.skills.find((r) => r.path === repoSkill);
      const resolvedPackageSkill = result.skills.find((r) => r.path === packageSkill);

      expect(resolvedRepoSkill?.metadata.source).toBe("auto");
      expect(resolvedRepoSkill?.metadata.scope).toBe("project");
      expect(resolvedRepoSkill?.metadata.baseDir).toBe(repoAgentsBaseDir);
      expect(resolvedPackageSkill?.metadata.source).toBe("auto");
      expect(resolvedPackageSkill?.metadata.scope).toBe("project");
      expect(resolvedPackageSkill?.metadata.baseDir).toBe(packageAgentsBaseDir);
    });
  });

  describe(".agents/skills auto-discovery", () => {
    it("should scan .agents/skills from cwd up to git repo root", async () => {
      const repoRoot = join(tempDir, "repo");
      const nestedCwd = join(repoRoot, "packages", "feature");
      mkdirSync(nestedCwd, { recursive: true });
      mkdirSync(join(repoRoot, ".git"), { recursive: true });

      const aboveRepoSkill = join(tempDir, ".agents", "skills", "above-repo", "SKILL.md");
      mkdirSync(join(tempDir, ".agents", "skills", "above-repo"), { recursive: true });
      writeFileSync(aboveRepoSkill, "---\nname: above-repo\ndescription: above\n---\n");

      const repoRootSkill = join(repoRoot, ".agents", "skills", "repo-root", "SKILL.md");
      mkdirSync(join(repoRoot, ".agents", "skills", "repo-root"), { recursive: true });
      writeFileSync(repoRootSkill, "---\nname: repo-root\ndescription: repo\n---\n");

      const nestedSkill = join(repoRoot, "packages", ".agents", "skills", "nested", "SKILL.md");
      mkdirSync(join(repoRoot, "packages", ".agents", "skills", "nested"), { recursive: true });
      writeFileSync(nestedSkill, "---\nname: nested\ndescription: nested\n---\n");

      const pm = new DefaultPackageManager({
        cwd: nestedCwd,
        agentDir,
        settingsManager,
      });

      const result = await pm.resolve();
      expect(result.skills.some((r) => r.path === repoRootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === aboveRepoSkill)).toBe(false);
    });

    it("should scan .agents/skills up to filesystem root when not in a git repo", async () => {
      const nonRepoRoot = join(tempDir, "non-repo");
      const nestedCwd = join(nonRepoRoot, "a", "b");
      mkdirSync(nestedCwd, { recursive: true });

      const rootSkill = join(nonRepoRoot, ".agents", "skills", "root", "SKILL.md");
      mkdirSync(join(nonRepoRoot, ".agents", "skills", "root"), { recursive: true });
      writeFileSync(rootSkill, "---\nname: root\ndescription: root\n---\n");

      const middleSkill = join(nonRepoRoot, "a", ".agents", "skills", "middle", "SKILL.md");
      mkdirSync(join(nonRepoRoot, "a", ".agents", "skills", "middle"), { recursive: true });
      writeFileSync(middleSkill, "---\nname: middle\ndescription: middle\n---\n");

      const pm = new DefaultPackageManager({
        cwd: nestedCwd,
        agentDir,
        settingsManager,
      });

      const result = await pm.resolve();
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === middleSkill && r.enabled)).toBe(true);
    });
  });
});
