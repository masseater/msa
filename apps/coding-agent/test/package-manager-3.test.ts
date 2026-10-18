import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  describe(".agents/skills auto-discovery", () => {
    it("should ignore root markdown files in .agents/skills but discover nested markdown skills", async () => {
      const agentsSkillsDir = join(tempDir, ".agents", "skills");
      mkdirSync(join(agentsSkillsDir, "nested-skill"), { recursive: true });
      mkdirSync(join(agentsSkillsDir, "third-party"), { recursive: true });
      mkdirSync(join(agentsSkillsDir, "third-party", "vendor", "pack"), { recursive: true });
      const rootSkill = join(agentsSkillsDir, "root-file.md");
      const nestedSkill = join(agentsSkillsDir, "nested-skill", "SKILL.md");
      const nestedMarkdownSkill = join(agentsSkillsDir, "third-party", "child-skill.md");
      const deeplyNestedMarkdownSkill = join(
        agentsSkillsDir,
        "third-party",
        "vendor",
        "pack",
        "deep-skill.md",
      );
      writeFileSync(rootSkill, "---\nname: root-file\ndescription: Root markdown file\n---\n");
      writeFileSync(nestedSkill, "---\nname: nested-skill\ndescription: Nested skill\n---\n");
      writeFileSync(
        nestedMarkdownSkill,
        "---\nname: child-skill\ndescription: Nested markdown skill\n---\n",
      );
      writeFileSync(
        deeplyNestedMarkdownSkill,
        "---\nname: deep-skill\ndescription: Deep markdown skill\n---\n",
      );

      const pm = new DefaultPackageManager({
        cwd: join(tempDir, "work"),
        agentDir,
        settingsManager,
      });
      mkdirSync(join(tempDir, "work"), { recursive: true });

      const result = await pm.resolve();
      expect(result.skills.some((r) => r.path === rootSkill)).toBe(false);
      expect(result.skills.some((r) => r.path === nestedSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedMarkdownSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === deeplyNestedMarkdownSkill && r.enabled)).toBe(
        true,
      );
    });

    it("should keep ~/.agents/skills user-scoped when cwd is under home in a non-git directory", async () => {
      const previousHome = process.env["HOME"];
      process.env["HOME"] = tempDir;

      try {
        const cwd = join(tempDir, "scratch", "nested");
        const localAgentDir = join(tempDir, ".msa", "agent");
        const localSettingsManager = SettingsManager.inMemory();
        mkdirSync(cwd, { recursive: true });
        mkdirSync(localAgentDir, { recursive: true });

        const homeSkill = join(tempDir, ".agents", "skills", "home-skill", "SKILL.md");
        mkdirSync(join(tempDir, ".agents", "skills", "home-skill"), { recursive: true });
        writeFileSync(homeSkill, "---\nname: home-skill\ndescription: home\n---\n");

        const pm = new DefaultPackageManager({
          cwd,
          agentDir: localAgentDir,
          settingsManager: localSettingsManager,
        });

        const result = await pm.resolve();
        const matchingSkills = result.skills.filter((r) => r.path === homeSkill);
        expect(matchingSkills).toHaveLength(1);
        expect(matchingSkills[0]?.enabled).toBe(true);
        expect(matchingSkills[0]?.metadata.scope).toBe("user");
        expect(matchingSkills[0]?.metadata.source).toBe("auto");
      } finally {
        if (previousHome === undefined) {
          delete process.env["HOME"];
        } else {
          process.env["HOME"] = previousHome;
        }
      }
    });

    it("should dedupe user skill entries when ~/.msa/agent/skills is a symlink to ~/.agents/skills", async () => {
      const previousHome = process.env["HOME"];
      process.env["HOME"] = tempDir;

      try {
        const agentSkillsDir = join(agentDir, "skills");
        const agentsSkillsDir = join(tempDir, ".agents", "skills");
        mkdirSync(agentsSkillsDir, { recursive: true });

        const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
        symlinkSync(agentsSkillsDir, agentSkillsDir, directoryLinkType);

        const skillPath = join(agentsSkillsDir, "foo", "SKILL.md");
        mkdirSync(join(agentsSkillsDir, "foo"), { recursive: true });
        writeFileSync(skillPath, "---\nname: foo\ndescription: foo\n---\n");

        const result = await packageManager.resolve();
        const fooSkills = result.skills.filter((r) => pathEndsWith(r.path, "foo/SKILL.md"));

        expect(fooSkills).toHaveLength(1);
      } finally {
        if (previousHome === undefined) {
          delete process.env["HOME"];
        } else {
          process.env["HOME"] = previousHome;
        }
      }
    });
  });

  describe("ignore files", () => {
    it("should respect .gitignore in skill directories", async () => {
      const skillsDir = join(agentDir, "skills");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(join(skillsDir, ".gitignore"), "venv\n__pycache__\n");

      const goodSkillDir = join(skillsDir, "good-skill");
      mkdirSync(goodSkillDir, { recursive: true });
      writeFileSync(
        join(goodSkillDir, "SKILL.md"),
        "---\nname: good-skill\ndescription: Good\n---\nContent",
      );

      const ignoredSkillDir = join(skillsDir, "venv", "bad-skill");
      mkdirSync(ignoredSkillDir, { recursive: true });
      writeFileSync(
        join(ignoredSkillDir, "SKILL.md"),
        "---\nname: bad-skill\ndescription: Bad\n---\nContent",
      );

      settingsManager.setSkillPaths(["skills"]);

      const result = await packageManager.resolve();
      expect(result.skills.some((r) => r.path.includes("good-skill") && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path.includes("venv") && r.enabled)).toBe(false);
    });

    it("should not apply parent .gitignore to .msa auto-discovery", async () => {
      writeFileSync(join(tempDir, ".gitignore"), ".msa\n");

      const skillDir = join(tempDir, ".msa", "skills", "auto-skill");
      mkdirSync(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      writeFileSync(skillPath, "---\nname: auto-skill\ndescription: Auto\n---\nContent");

      const result = await packageManager.resolve();
      expect(result.skills.some((r) => r.path === skillPath && r.enabled)).toBe(true);
    });
  });

  describe("resolveExtensionSources", () => {
    it("should resolve local paths", async () => {
      const extPath = join(tempDir, "ext.ts");
      writeFileSync(extPath, "export default function() {}");

      const result = await packageManager.resolveExtensionSources([extPath]);
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    });

    it("should handle directories with msa manifest", async () => {
      const pkgDir = join(tempDir, "my-package");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "my-package",
          msa: {
            extensions: ["./src/index.ts"],
            skills: ["./skills"],
          },
        }),
      );
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      writeFileSync(join(pkgDir, "src", "index.ts"), "export default function() {}");
      mkdirSync(join(pkgDir, "skills", "my-skill"), { recursive: true });
      writeFileSync(
        join(pkgDir, "skills", "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: Test\n---\nContent",
      );

      const result = await packageManager.resolveExtensionSources([pkgDir]);
      expect(
        result.extensions.some((r) => r.path === join(pkgDir, "src", "index.ts") && r.enabled),
      ).toBe(true);

      expect(
        result.skills.some(
          (r) => r.path === join(pkgDir, "skills", "my-skill", "SKILL.md") && r.enabled,
        ),
      ).toBe(true);
    });
  });
});
