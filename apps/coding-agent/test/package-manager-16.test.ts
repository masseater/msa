import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { pathEndsWith, type PackageManagerInternals } from "./package-manager-support.ts";

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

  describe("offline mode and network timeouts", () => {
    it("should skip installing missing package sources when offline", async () => {
      process.env["MSA_OFFLINE"] = "1";
      settingsManager.setProjectPackages([
        "npm:missing-package",
        "git:github.com/example/missing-repo",
      ]);

      const installParsedSourceSpy = vi.spyOn(packageManager as any, "installParsedSource");

      const result = await packageManager.resolve();
      const allResources = [
        ...result.extensions,
        ...result.skills,
        ...result.prompts,
        ...result.themes,
      ];
      expect(allResources.some((r) => r.metadata.origin === "package")).toBe(false);
      expect(installParsedSourceSpy).not.toHaveBeenCalled();
    });

    it("should skip refreshing temporary git sources when offline", async () => {
      process.env["MSA_OFFLINE"] = "1";
      const gitSource = "git:github.com/example/repo";
      const parsedGitSource = (packageManager as any).parseSource(gitSource);
      const installedPath = (packageManager as any).getGitInstallPath(
        parsedGitSource,
        "temporary",
      ) as string;

      mkdirSync(join(installedPath, "extensions"), { recursive: true });
      writeFileSync(join(installedPath, "extensions", "index.ts"), "export default function() {};");

      const refreshTemporaryGitSourceSpy = vi.spyOn(
        packageManager as any,
        "refreshTemporaryGitSource",
      );

      const result = await packageManager.resolveExtensionSources([gitSource], { temporary: true });
      expect(
        result.extensions.some((r) => pathEndsWith(r.path, "extensions/index.ts") && r.enabled),
      ).toBe(true);
      expect(refreshTemporaryGitSourceSpy).not.toHaveBeenCalled();
    });

    it("should load a new checkout when a pinned temporary git source changes ref", async () => {
      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      const oldSource = "git:github.com/example/repo@aaaaaaa";
      const newSource = "git:github.com/example/repo@bbbbbbb";
      const oldParsed = managerWithInternals.parseSource(oldSource);
      const newParsed = managerWithInternals.parseSource(newSource);
      if (oldParsed.type !== "git" || newParsed.type !== "git") {
        throw new Error("Expected git sources");
      }

      const oldPath = managerWithInternals.getGitInstallPath(oldParsed, "temporary");
      mkdirSync(join(oldPath, "extensions"), { recursive: true });
      writeFileSync(join(oldPath, "extensions", "old.ts"), "export default function() {};");

      const installParsedSourceSpy = vi
        .spyOn(packageManager as any, "installParsedSource")
        .mockImplementation(async () => {
          const newPath = managerWithInternals.getGitInstallPath(newParsed, "temporary");
          mkdirSync(join(newPath, "extensions"), { recursive: true });
          writeFileSync(join(newPath, "extensions", "new.ts"), "export default function() {};");
        });

      const result = await packageManager.resolveExtensionSources([newSource], { temporary: true });
      expect(installParsedSourceSpy).toHaveBeenCalledTimes(1);
      expect(
        result.extensions.some((r) => pathEndsWith(r.path, "extensions/new.ts") && r.enabled),
      ).toBe(true);
      expect(result.extensions.some((r) => pathEndsWith(r.path, "extensions/old.ts"))).toBe(false);
    });

    it("should not run npm view during resolve for installed unpinned packages", async () => {
      process.env["MSA_OFFLINE"] = "1";
      const installedPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(join(installedPath, "extensions"), { recursive: true });
      writeFileSync(
        join(installedPath, "package.json"),
        JSON.stringify({ name: "example", version: "1.0.0" }),
      );
      writeFileSync(join(installedPath, "extensions", "index.ts"), "export default function() {};");
      settingsManager.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi.spyOn(packageManager as any, "runCommandCapture");

      const result = await packageManager.resolve();
      expect(
        result.extensions.some((r) => pathEndsWith(r.path, "extensions/index.ts") && r.enabled),
      ).toBe(true);
      expect(runCommandCaptureSpy).not.toHaveBeenCalled();
    });

    it("should reinstall pinned npm packages when installed version does not match", async () => {
      const installedPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(installedPath, { recursive: true });
      writeFileSync(
        join(installedPath, "package.json"),
        JSON.stringify({ name: "example", version: "1.0.0" }),
      );
      settingsManager.setProjectPackages(["npm:example@2.0.0"]);

      const installParsedSourceSpy = vi
        .spyOn(packageManager as any, "installParsedSource")
        .mockResolvedValue(undefined);

      await packageManager.resolve();
      expect(installParsedSourceSpy).toHaveBeenCalledTimes(1);
    });

    it("should not check package updates when offline", async () => {
      process.env["MSA_OFFLINE"] = "1";
      const runCommandCaptureSpy = vi.spyOn(packageManager as any, "runCommandCapture");

      const updates = await packageManager.checkForAvailableUpdates();
      expect(updates).toEqual([]);
      expect(runCommandCaptureSpy).not.toHaveBeenCalled();
    });

    it("should report updates for installed unpinned npm packages", async () => {
      const installedPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(installedPath, { recursive: true });
      writeFileSync(
        join(installedPath, "package.json"),
        JSON.stringify({ name: "example", version: "1.0.0" }),
      );
      settingsManager.setProjectPackages(["npm:example"]);

      vi.spyOn(packageManager as any, "runCommandCapture").mockResolvedValue('"1.2.3"');

      const updates = await packageManager.checkForAvailableUpdates();
      expect(updates).toEqual([
        {
          source: "npm:example",
          displayName: "example",
          type: "npm",
          scope: "project",
        },
      ]);
    });

    it("should not report npm updates when the installed version is newer than the registry version", async () => {
      const installedPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(installedPath, { recursive: true });
      writeFileSync(
        join(installedPath, "package.json"),
        JSON.stringify({ name: "example", version: "2.0.0" }),
      );
      settingsManager.setProjectPackages(["npm:example"]);

      vi.spyOn(packageManager as any, "runCommandCapture").mockResolvedValue('"1.9.0"');

      const updates = await packageManager.checkForAvailableUpdates();
      expect(updates).toEqual([]);
    });

    it("should skip pinned packages when checking for updates", async () => {
      const installedNpmPath = join(tempDir, ".msa", "npm", "node_modules", "example");
      mkdirSync(installedNpmPath, { recursive: true });
      writeFileSync(
        join(installedNpmPath, "package.json"),
        JSON.stringify({ name: "example", version: "1.0.0" }),
      );
      const parsedGitSource = (packageManager as any).parseSource("git:github.com/example/repo@v1");
      const installedGitPath = (packageManager as any).getGitInstallPath(
        parsedGitSource,
        "project",
      ) as string;
      mkdirSync(installedGitPath, { recursive: true });

      settingsManager.setProjectPackages(["npm:example@1.0.0", "git:github.com/example/repo@v1"]);

      const runCommandCaptureSpy = vi.spyOn(packageManager as any, "runCommandCapture");
      const gitUpdateSpy = vi.spyOn(packageManager as any, "gitHasAvailableUpdate");

      const updates = await packageManager.checkForAvailableUpdates();
      expect(updates).toEqual([]);
      expect(runCommandCaptureSpy).not.toHaveBeenCalled();
      expect(gitUpdateSpy).not.toHaveBeenCalled();
    });
  });
});
