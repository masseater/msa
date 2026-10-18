import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  describe("npmCommand", () => {
    it("should disable peer installation through wrapped pnpm when updating git dependencies", async () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "pnpm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

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
        "mise",
        [
          "exec",
          "node@20",
          "--",
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

    it("should use npmCommand argv for npm root lookup and invalidate cached root when npmCommand changes", () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "npm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const root20 = join(tempDir, "node20", "lib", "node_modules");
      const root22 = join(tempDir, "node22", "lib", "node_modules");
      mkdirSync(join(root20, "@scope", "pkg"), { recursive: true });

      const runCommandSyncSpy = vi
        .spyOn(packageManager as any, "runCommandSync")
        .mockImplementation((...callArgs: unknown[]) => {
          const [command, args] = callArgs as [string, string[]];
          if (command !== "mise") {
            throw new Error(`unexpected command ${command}`);
          }
          if (args[1] === "node@20") {
            return root20;
          }
          if (args[1] === "node@22") {
            return root22;
          }
          throw new Error(`unexpected args ${args.join(" ")}`);
        });

      expect(packageManager.getInstalledPath("npm:@scope/pkg", "user")).toBe(
        join(root20, "@scope", "pkg"),
      );
      expect(runCommandSyncSpy).toHaveBeenNthCalledWith(1, "mise", [
        "exec",
        "node@20",
        "--",
        "npm",
        "root",
        "-g",
      ]);

      settingsManager.setNpmCommand(["mise", "exec", "node@22", "--", "npm"]);

      expect(packageManager.getInstalledPath("npm:@scope/pkg", "user")).toBeUndefined();
      expect(runCommandSyncSpy).toHaveBeenNthCalledWith(2, "mise", [
        "exec",
        "node@22",
        "--",
        "npm",
        "root",
        "-g",
      ]);
    });

    it("should install user npm packages into the msa-managed npm root", async () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["pnpm"],
        packages: ["npm:pnpm-pkg"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const packagePath = join(agentDir, "npm", "node_modules", "pnpm-pkg");
      vi.spyOn(packageManager as any, "runCommandSync").mockImplementation(() => {
        throw new Error("legacy lookup unavailable");
      });
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockImplementation(async (...callArgs: unknown[]) => {
          const [command, args] = callArgs as [string, string[]];
          expect(command).toBe("pnpm");
          expect(args).toEqual([
            "install",
            "pnpm-pkg",
            "--prefix",
            join(agentDir, "npm"),
            "--config.auto-install-peers=false",
            "--config.strict-peer-dependencies=false",
            "--config.strict-dep-builds=false",
          ]);
          mkdirSync(join(packagePath, "extensions"), { recursive: true });
          writeFileSync(
            join(packagePath, "package.json"),
            JSON.stringify({ name: "pnpm-pkg", version: "1.0.0" }),
          );
          writeFileSync(
            join(packagePath, "extensions", "index.ts"),
            "export default function() {};",
          );
        });

      const first = await packageManager.resolve();
      const second = await packageManager.resolve();

      expect(
        first.extensions.some(
          (r) => r.path === join(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        second.extensions.some(
          (r) => r.path === join(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(runCommandSpy).toHaveBeenCalledTimes(1);
      expect(packageManager.getInstalledPath("npm:pnpm-pkg", "user")).toBe(packagePath);
    });
  });
});
