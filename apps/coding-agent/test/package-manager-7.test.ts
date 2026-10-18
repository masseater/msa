import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { Effect } from "effect";
import { nodeFs, writeJsonFileSync } from "./package-manager-support.ts";
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

  describe("npmCommand", () => {
    it("should disable peer installation through wrapped pnpm when updating git dependencies", () => runTest(
Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "pnpm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const source = "git:github.com/user/repo";
      const targetDir = joinPath(tempDir, ".msa", "git", "github.com", "user", "repo");
      (yield* makeDirectory(targetDir));
      (yield* writeTextFile(joinPath(targetDir, "package.json"), (yield* toJsonText({ name: "repo", version: "1.0.0" }))));
      settingsManager.setProjectPackages([source]);

      vi.spyOn(packageManager as any, "runCommandCapture").mockImplementation(
        (...callArgs: unknown[]) => effectRunPromise(
Effect.gen(function* () {

          const [_command, args] = callArgs as [string, string[]];
          if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}") {
            return (yield* awaited("origin/main"));
          }
          if (
            args[0] === "rev-parse" &&
            (args[1] === "@{upstream}" || args[1] === "@{upstream}^{commit}")
          ) {
            return (yield* awaited("remote-head"));
          }
          if (args[0] === "rev-parse" && args[1] === "HEAD") {
            return (yield* awaited("local-head"));
          }
          throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
        
}),
),
      );
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockResolvedValue(undefined);

      (yield* awaited(packageManager.update(source)));

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
    
}),
));

    it("should use npmCommand argv for npm root lookup and invalidate cached root when npmCommand changes", () => {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "npm"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const root20 = joinPath(tempDir, "node20", "lib", "node_modules");
      const root22 = joinPath(tempDir, "node22", "lib", "node_modules");
      nodeFs.mkdirSync(joinPath(root20, "@scope", "pkg"), { recursive: true });

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
        joinPath(root20, "@scope", "pkg"),
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

    it("should install user npm packages into the msa-managed npm root", () => runTest(
Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      settingsManager = SettingsManager.inMemory({
        npmCommand: ["pnpm"],
        packages: ["npm:pnpm-pkg"],
      });
      packageManager = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
      });

      const packagePath = joinPath(agentDir, "npm", "node_modules", "pnpm-pkg");
      vi.spyOn(packageManager as any, "runCommandSync").mockImplementation(() => {
        throw new Error("legacy lookup unavailable");
      });
      const runCommandSpy = vi
        .spyOn(packageManager as any, "runCommand")
        .mockImplementation((...callArgs: unknown[]) => effectRunPromise(
Effect.sync(() => {

          const [command, args] = callArgs as [string, string[]];
          expect(command).toBe("pnpm");
          expect(args).toEqual([
            "install",
            "pnpm-pkg",
            "--prefix",
            joinPath(agentDir, "npm"),
            "--config.auto-install-peers=false",
            "--config.strict-peer-dependencies=false",
            "--config.strict-dep-builds=false",
          ]);
          nodeFs.mkdirSync(joinPath(packagePath, "extensions"), { recursive: true });
          writeJsonFileSync({
            file: joinPath(packagePath, "package.json"),
            value: { name: "pnpm-pkg", version: "1.0.0" },
          });
          nodeFs.writeFileSync(
            joinPath(packagePath, "extensions", "index.ts"),
            "export default function() {};",
          );
        
}),
));

      const first = (yield* awaited(packageManager.resolve()));
      const second = (yield* awaited(packageManager.resolve()));

      expect(
        first.extensions.some(
          (r) => r.path === joinPath(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        second.extensions.some(
          (r) => r.path === joinPath(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(runCommandSpy).toHaveBeenCalledTimes(1);
      expect(packageManager.getInstalledPath("npm:pnpm-pkg", "user")).toBe(packagePath);
    
}),
));
  });
});
