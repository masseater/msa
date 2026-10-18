import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { type PackageManagerInternals } from "./package-manager-support.ts";

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

  describe("npmCommand", () => {
    it("should detect pnpm through a corepack wrapper without a separator", async () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["corepack", "pnpm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

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
        "corepack",
        [
          "pnpm",
          "install",
          "--prod",
          "--config.auto-install-peers=false",
          "--config.strict-peer-dependencies=false",
          "--config.strict-dep-builds=false",
        ],
        { cwd: targetDir },
      );
    });

    it("should disable peer installation for git package dependencies with bun", async () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["bun"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

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

      expect(runCommandSpy).toHaveBeenCalledWith("bun", ["install", "--omit=dev", "--omit=peer"], {
        cwd: targetDir,
      });
    });

    it("should update git package dependencies without auto-installing peers", async () => {
      const source = "git:github.com/user/repo";
      const targetDir = join(tempDir, ".msa", "git", "github.com", "user", "repo");
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(
        join(targetDir, "package.json"),
        JSON.stringify({ name: "repo", version: "1.0.0" }),
      );
      settingsManager.setProjectPackages([source]);

      vi.spyOn(packageManager as any, "runCommandCapture").mockImplementation(
        async (...callArgs: unknown[]) => {
          const [_command, args] = callArgs as [string, string[]];
          if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}") {
            return "origin/main";
          }
          if (
            args[0] === "rev-parse" &&
            (args[1] === "@{upstream}" || args[1] === "@{upstream}^{commit}")
          ) {
            return "remote-head";
          }
          if (args[0] === "rev-parse" && args[1] === "HEAD") {
            return "local-head";
          }
          throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
        },
      );
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.update(source);

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["install", "--omit=dev", "--legacy-peer-deps"],
        {
          cwd: targetDir,
        },
      );
    });

    it("should repair missing git package dependencies when the checkout is already current", async () => {
      const source = "git:github.com/user/repo";
      const targetDir = join(agentDir, "git", "github.com", "user", "repo");
      const fetchArgs = [
        "fetch",
        "--prune",
        "--no-tags",
        "origin",
        "+refs/heads/main:refs/remotes/origin/main",
      ];
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(
        join(targetDir, "package.json"),
        JSON.stringify({ name: "repo", version: "1.0.0", dependencies: { dependency: "1.0.0" } }),
      );
      settingsManager.setPackages([source]);

      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      vi.spyOn(managerWithInternals, "getLocalGitUpdateTarget").mockResolvedValue({
        ref: "@{upstream}",
        head: "current-head",
        fetchArgs,
      });
      vi.spyOn(managerWithInternals, "runCommandCapture").mockResolvedValue("current-head");
      const runCommandSpy = vi
        .spyOn(managerWithInternals, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.update(source);

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["install", "--omit=dev", "--legacy-peer-deps"],
        {
          cwd: targetDir,
        },
      );
      expect(runCommandSpy).not.toHaveBeenCalledWith("git", ["clean", "-fdx"], { cwd: targetDir });
    });

    it("should repair deleted git package dependencies when cleaning fails", async () => {
      const source = "git:github.com/user/repo";
      const targetDir = join(agentDir, "git", "github.com", "user", "repo");
      const fetchArgs = [
        "fetch",
        "--prune",
        "--no-tags",
        "origin",
        "+refs/heads/main:refs/remotes/origin/main",
      ];
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(
        join(targetDir, "package.json"),
        JSON.stringify({ name: "repo", version: "1.0.0", dependencies: { dependency: "1.0.0" } }),
      );
      settingsManager.setPackages([source]);

      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      vi.spyOn(managerWithInternals, "getLocalGitUpdateTarget").mockResolvedValue({
        ref: "@{upstream}",
        head: "new-head",
        fetchArgs,
      });
      vi.spyOn(managerWithInternals, "runCommandCapture").mockImplementation(
        async (_command, args) => (args[1] === "HEAD" ? "old-head" : "new-head"),
      );
      const runCommandSpy = vi
        .spyOn(managerWithInternals, "runCommand")
        .mockImplementation(async (_command, args) => {
          if (args[0] === "clean") throw new Error("simulated clean failure");
        });

      await expect(packageManager.update(source)).rejects.toThrow("simulated clean failure");

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
