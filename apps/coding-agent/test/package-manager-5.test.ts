import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    it("should remove a newly created checkout when git clone fails", async () => {
      const source = "git:github.com/user/repo";
      const targetDir = join(agentDir, "git", "github.com", "user", "repo");
      vi.spyOn(packageManager as any, "runCommand").mockImplementation(
        async (...callArgs: unknown[]) => {
          const [command, args] = callArgs as [string, string[]];
          if (command === "git" && args[0] === "clone") {
            mkdirSync(targetDir, { recursive: true });
            throw new Error("simulated git clone failure");
          }
        },
      );

      await expect(packageManager.install(source)).rejects.toThrow("simulated git clone failure");

      expect(existsSync(targetDir)).toBe(false);
    });

    it("should remove a newly cloned checkout when dependency installation fails", async () => {
      const source = "git:github.com/user/repo";
      const targetDir = join(agentDir, "git", "github.com", "user", "repo");
      vi.spyOn(packageManager as any, "runCommand").mockImplementation(
        async (...callArgs: unknown[]) => {
          const [command, args] = callArgs as [string, string[]];
          if (command === "git" && args[0] === "clone") {
            mkdirSync(targetDir, { recursive: true });
            writeFileSync(
              join(targetDir, "package.json"),
              JSON.stringify({ name: "repo", version: "1.0.0" }),
            );
            return;
          }
          if (command === "npm") {
            throw new Error("simulated dependency install failure");
          }
        },
      );

      await expect(packageManager.install(source)).rejects.toThrow(
        "simulated dependency install failure",
      );

      expect(existsSync(targetDir)).toBe(false);
    });

    it("should reconcile an existing git checkout to a pinned ref during install", async () => {
      const source = "git:github.com/user/repo@v2";
      const targetDir = join(agentDir, "git", "github.com", "user", "repo");
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(
        join(targetDir, "package.json"),
        JSON.stringify({ name: "repo", version: "1.0.0" }),
      );

      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      vi.spyOn(managerWithInternals, "runCommandCapture").mockImplementation(
        async (_command, args) => {
          if (args[0] === "rev-parse" && args[1] === "HEAD") {
            return "old-head";
          }
          if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD^{commit}") {
            return "new-head";
          }
          throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
        },
      );
      const runCommandSpy = vi
        .spyOn(managerWithInternals, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.install(source);

      expect(runCommandSpy).toHaveBeenCalledWith("git", ["fetch", "origin", "v2"], {
        cwd: targetDir,
      });
      expect(runCommandSpy).toHaveBeenCalledWith(
        "git",
        ["reset", "--hard", "FETCH_HEAD^{commit}"],
        {
          cwd: targetDir,
        },
      );
      expect(runCommandSpy).toHaveBeenCalledWith("git", ["clean", "-fdx"], { cwd: targetDir });
      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["install", "--omit=dev", "--legacy-peer-deps"],
        {
          cwd: targetDir,
        },
      );
    });

    it("should reconcile an existing git checkout to its update target when installing without a ref", async () => {
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

      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      vi.spyOn(managerWithInternals, "getLocalGitUpdateTarget").mockResolvedValue({
        ref: "origin/HEAD",
        head: "new-head",
        fetchArgs,
      });
      vi.spyOn(managerWithInternals, "runCommandCapture").mockImplementation(
        async (_command, args) => {
          if (args[0] === "rev-parse" && args[1] === "HEAD") {
            return "old-head";
          }
          if (args[0] === "rev-parse" && args[1] === "origin/HEAD^{commit}") {
            return "new-head";
          }
          throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
        },
      );
      const runCommandSpy = vi
        .spyOn(managerWithInternals, "runCommand")
        .mockResolvedValue(undefined);

      await packageManager.install(source);

      expect(runCommandSpy).toHaveBeenCalledWith("git", fetchArgs, { cwd: targetDir });
      expect(runCommandSpy).toHaveBeenCalledWith(
        "git",
        ["reset", "--hard", "origin/HEAD^{commit}"],
        {
          cwd: targetDir,
        },
      );
      expect(runCommandSpy).toHaveBeenCalledWith("git", ["clean", "-fdx"], { cwd: targetDir });
    });

    it("should prefer the package manager after a separator over the outer executable", () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["npm", "exec", "--", "pnpm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const managerWithInternals = packageManager as unknown as PackageManagerInternals;
      expect(managerWithInternals.getPackageManagerName()).toBe("pnpm");
      expect(managerWithInternals.getGitDependencyInstallArgs()).toEqual([
        "install",
        "--prod",
        "--config.auto-install-peers=false",
        "--config.strict-peer-dependencies=false",
        "--config.strict-dep-builds=false",
      ]);
    });
  });
});
