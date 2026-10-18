import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

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
    it("should return no package-sourced paths when no sources configured", async () => {
      const result = await packageManager.resolve();
      expect(result.extensions).toEqual([]);
      expect(result.prompts).toEqual([]);
      expect(result.themes).toEqual([]);
      expect(
        result.skills.every(
          (r) => r.metadata.source === "auto" && r.metadata.origin === "top-level",
        ),
      ).toBe(true);
    });

    it("should resolve local extension paths from settings", async () => {
      const extDir = join(agentDir, "extensions");
      mkdirSync(extDir, { recursive: true });
      const extPath = join(extDir, "my-extension.ts");
      writeFileSync(extPath, "export default function() {}");
      settingsManager.setExtensionPaths(["extensions/my-extension.ts"]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    });

    it("should resolve built-in extensions with user exclusions and project overrides", async () => {
      const pm = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
        builtinExtensions: ["mcp", "llama.cpp"],
      });
      const builtins = async () =>
        (await pm.resolve()).extensions.map((r) => [
          r.path,
          r.enabled,
          r.metadata.source,
          r.metadata.scope,
        ]);

      expect(await builtins()).toEqual([
        ["builtin:mcp", true, "builtin", "user"],
        ["builtin:llama.cpp", true, "builtin", "user"],
      ]);

      settingsManager.setExtensionPaths(["-builtin:mcp"]);
      settingsManager.setProjectExtensionPaths(["+builtin:mcp", "-builtin:llama.cpp"]);
      expect(await builtins()).toEqual([
        ["builtin:mcp", true, "builtin", "project"],
        ["builtin:llama.cpp", false, "builtin", "project"],
      ]);

      settingsManager.setProjectExtensionPaths([]);
      expect(await builtins()).toEqual([
        ["builtin:mcp", false, "builtin", "user"],
        ["builtin:llama.cpp", true, "builtin", "user"],
      ]);
    });

    it("should resolve skill paths from settings", async () => {
      const skillDir = join(agentDir, "skills", "my-skill");
      mkdirSync(skillDir, { recursive: true });
      const skillFile = join(skillDir, "SKILL.md");
      writeFileSync(
        skillFile,
        `---
name: test-skill
description: A test skill
---
Content`,
      );

      settingsManager.setSkillPaths(["skills"]);

      const result = await packageManager.resolve();

      expect(result.skills.some((r) => r.path === skillFile && r.enabled)).toBe(true);
    });

    it("should auto-discover root markdown skills from .msa skill dirs", async () => {
      const skillFile = join(agentDir, "skills", "single-file.md");
      mkdirSync(join(agentDir, "skills"), { recursive: true });
      writeFileSync(
        skillFile,
        `---
name: single-file
description: A root markdown skill
---
Content`,
      );

      const result = await packageManager.resolve();
      expect(result.skills.some((r) => r.path === skillFile && r.enabled)).toBe(true);
    });

    it("should resolve project paths relative to .msa", async () => {
      const extDir = join(tempDir, ".msa", "extensions");
      mkdirSync(extDir, { recursive: true });
      const extPath = join(extDir, "project-ext.ts");
      writeFileSync(extPath, "export default function() {}");

      settingsManager.setProjectExtensionPaths(["extensions/project-ext.ts"]);

      const result = await packageManager.resolve();
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    });

    it("should auto-discover user prompts with overrides", async () => {
      const promptsDir = join(agentDir, "prompts");
      mkdirSync(promptsDir, { recursive: true });
      const promptPath = join(promptsDir, "auto.md");
      writeFileSync(promptPath, "Auto prompt");

      settingsManager.setPromptTemplatePaths(["!prompts/auto.md"]);

      const result = await packageManager.resolve();
      expect(result.prompts.some((r) => r.path === promptPath && !r.enabled)).toBe(true);
    });

    it("should resolve symlinked user and project resources once", async () => {
      const previousHome = process.env["HOME"];
      process.env["HOME"] = tempDir;

      try {
        const sharedDir = join(tempDir, "shared-resources");
        const sharedExtensionsDir = join(sharedDir, "extensions");
        const sharedSkillsDir = join(sharedDir, "skills");
        const sharedPromptsDir = join(sharedDir, "prompts");
        const sharedThemesDir = join(sharedDir, "themes");
        mkdirSync(sharedExtensionsDir, { recursive: true });
        mkdirSync(sharedSkillsDir, { recursive: true });
        mkdirSync(sharedPromptsDir, { recursive: true });
        mkdirSync(sharedThemesDir, { recursive: true });

        writeFileSync(join(sharedExtensionsDir, "shared.ts"), "export default function() {}");
        mkdirSync(join(sharedSkillsDir, "shared-skill"), { recursive: true });
        writeFileSync(
          join(sharedSkillsDir, "shared-skill", "SKILL.md"),
          `---
name: shared-skill
description: Shared skill
---
Content`,
        );
        writeFileSync(join(sharedPromptsDir, "shared.md"), "Shared prompt");
        writeFileSync(
          join(sharedThemesDir, "shared.json"),
          JSON.stringify({ name: "shared-theme" }),
        );

        mkdirSync(join(agentDir), { recursive: true });
        mkdirSync(join(tempDir, ".msa"), { recursive: true });
        symlinkSync(sharedExtensionsDir, join(agentDir, "extensions"), "dir");
        symlinkSync(sharedSkillsDir, join(agentDir, "skills"), "dir");
        symlinkSync(sharedPromptsDir, join(agentDir, "prompts"), "dir");
        symlinkSync(sharedThemesDir, join(agentDir, "themes"), "dir");
        symlinkSync(sharedExtensionsDir, join(tempDir, ".msa", "extensions"), "dir");
        symlinkSync(sharedSkillsDir, join(tempDir, ".msa", "skills"), "dir");
        symlinkSync(sharedPromptsDir, join(tempDir, ".msa", "prompts"), "dir");
        symlinkSync(sharedThemesDir, join(tempDir, ".msa", "themes"), "dir");

        const result = await packageManager.resolve();

        expect({
          extensions: result.extensions.length,
          skills: result.skills.length,
          prompts: result.prompts.length,
          themes: result.themes.length,
        }).toEqual({
          extensions: 1,
          skills: 1,
          prompts: 1,
          themes: 1,
        });

        expect(result.extensions[0]?.metadata.scope).toBe("project");
        expect(result.skills[0]?.metadata.scope).toBe("project");
        expect(result.prompts[0]?.metadata.scope).toBe("project");
        expect(result.themes[0]?.metadata.scope).toBe("project");
      } finally {
        if (previousHome === undefined) {
          delete process.env["HOME"];
        } else {
          process.env["HOME"] = previousHome;
        }
      }
    });
  });
});
