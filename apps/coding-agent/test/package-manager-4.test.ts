import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager, type ProgressEvent } from "../src/core/package-manager.ts";
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

  describe("resolveExtensionSources", () => {
    it("should keep msa manifest entries with leading tilde package-relative", async () => {
      const pkgDir = join(tempDir, "tilde-manifest-package");
      const directExtensionPath = join(pkgDir, "~extensions", "main.ts");
      const slashExtensionPath = join(pkgDir, "~", "extensions", "alt.ts");
      const directSkillPath = join(pkgDir, "~skills", "direct-skill", "SKILL.md");
      const slashSkillPath = join(pkgDir, "~", "skills", "slash-skill", "SKILL.md");

      mkdirSync(join(pkgDir, "~extensions"), { recursive: true });
      mkdirSync(join(pkgDir, "~", "extensions"), { recursive: true });
      mkdirSync(join(pkgDir, "~skills", "direct-skill"), { recursive: true });
      mkdirSync(join(pkgDir, "~", "skills", "slash-skill"), { recursive: true });
      writeFileSync(directExtensionPath, "export default function() {}");
      writeFileSync(slashExtensionPath, "export default function() {}");
      writeFileSync(directSkillPath, "---\nname: direct-skill\ndescription: Direct\n---\nContent");
      writeFileSync(slashSkillPath, "---\nname: slash-skill\ndescription: Slash\n---\nContent");
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "tilde-manifest-package",
          msa: {
            extensions: ["~extensions/main.ts", "~/extensions/alt.ts"],
            skills: ["~skills", "~/skills"],
          },
        }),
      );

      const result = await packageManager.resolveExtensionSources([pkgDir]);

      expect(result.extensions.some((r) => r.path === directExtensionPath && r.enabled)).toBe(true);
      expect(result.extensions.some((r) => r.path === slashExtensionPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === directSkillPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === slashSkillPath && r.enabled)).toBe(true);
    });

    it("should handle directories with auto-discovery layout", async () => {
      const pkgDir = join(tempDir, "auto-pkg");
      mkdirSync(join(pkgDir, "extensions"), { recursive: true });
      mkdirSync(join(pkgDir, "themes"), { recursive: true });
      writeFileSync(join(pkgDir, "extensions", "main.ts"), "export default function() {}");
      writeFileSync(join(pkgDir, "themes", "dark.json"), "{}");

      const result = await packageManager.resolveExtensionSources([pkgDir]);
      expect(result.extensions.some((r) => pathEndsWith(r.path, "main.ts") && r.enabled)).toBe(
        true,
      );
      expect(result.themes.some((r) => pathEndsWith(r.path, "dark.json") && r.enabled)).toBe(true);
    });

    it("should stop recursing when a package skill directory contains SKILL.md", async () => {
      const pkgDir = join(tempDir, "skill-root-pkg");
      mkdirSync(join(pkgDir, "skills", "root-skill", "nested-skill"), { recursive: true });
      const rootSkill = join(pkgDir, "skills", "root-skill", "SKILL.md");
      const nestedSkill = join(pkgDir, "skills", "root-skill", "nested-skill", "SKILL.md");
      writeFileSync(rootSkill, "---\nname: root-skill\ndescription: Root skill\n---\n");
      writeFileSync(nestedSkill, "---\nname: nested-skill\ndescription: Nested skill\n---\n");

      const result = await packageManager.resolveExtensionSources([pkgDir]);
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedSkill)).toBe(false);
    });
  });

  describe("progress callback", () => {
    it("should emit progress events", async () => {
      const events: ProgressEvent[] = [];
      packageManager.setProgressCallback((event) => events.push(event));

      const extPath = join(tempDir, "ext.ts");
      writeFileSync(extPath, "export default function() {}");

      await packageManager.resolveExtensionSources([extPath]);

      expect(events.length).toBe(0);
    });
  });

  describe("command spawning", () => {
    it("should preserve argv entries containing spaces", () => {
      const managerWithInternals = packageManager as unknown as {
        runCommandSync(command: string, args: string[]): string;
      };
      const valueWithSpace = "C:\\Users\\A B\\.msa\\npm";
      const output = managerWithInternals.runCommandSync(process.execPath, [
        "-e",
        "console.log(process.argv[1])",
        valueWithSpace,
      ]);

      expect(output).toBe(valueWithSpace);
    });
  });

  describe("npmCommand", () => {
    it("should use npmCommand argv for npm installs", async () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "npm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.install("npm:@scope/pkg");

      expect(runCommandSpy).toHaveBeenCalledWith(
        "mise",
        [
          "exec",
          "node@20",
          "--",
          "npm",
          "install",
          "@scope/pkg",
          "--prefix",
          join(agentDir, "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    });

    it("should pass legacy peer deps when uninstalling npm packages", async () => {
      mkdirSync(join(agentDir, "npm"), { recursive: true });
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.remove("npm:@scope/pkg");

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["uninstall", "@scope/pkg", "--prefix", join(agentDir, "npm"), "--legacy-peer-deps"],
        undefined,
      );
    });

    it("should use bun --cwd for npm package installs", async () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "bun@1", "--", "bun"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.install("npm:@scope/pkg");

      expect(runCommandSpy).toHaveBeenCalledWith(
        "mise",
        [
          "exec",
          "bun@1",
          "--",
          "bun",
          "install",
          "@scope/pkg",
          "--cwd",
          join(agentDir, "npm"),
          "--omit=peer",
        ],
        undefined,
      );
    });

    it("should install git package dependencies without auto-installing peers", async () => {
      const source = "git:github.com/user/repo";
      const targetDir = join(agentDir, "git", "github.com", "user", "repo");
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockImplementation(async (...callArgs: unknown[]) => {
          const [command, args] = callArgs as [string, string[]];
          if (command === "git" && args[0] === "clone") {
            mkdirSync(targetDir, { recursive: true });
            writeFileSync(
              join(targetDir, "package.json"),
              JSON.stringify({ name: "repo", version: "1.0.0" }),
            );
          }
        });

      await packageManager.install(source);

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["install", "--omit=dev", "--legacy-peer-deps"],
        {
          cwd: targetDir,
        },
      );
    });
  });
});
