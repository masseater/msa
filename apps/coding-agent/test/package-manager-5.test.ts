import {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
  nodeFs,
  type PackageManagerInternals,
  writeJsonFileSync,
} from "./package-manager-support.ts";

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
    it("should remove a newly created checkout when git clone fails", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const source = "git:github.com/user/repo";
          const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
          vi.spyOn(packageManager as any, "runCommand").mockImplementation(
            (...callArgs: unknown[]) =>
              effectRunPromise(
                Effect.sync(() => {
                  const [command, args] = callArgs as [string, string[]];
                  if (command === "git" && args[0] === "clone") {
                    nodeFs.mkdirSync(targetDir, { recursive: true });
                    throw new Error("simulated git clone failure");
                  }
                }),
              ),
          );

          yield* awaited(
            expect(packageManager.install(source)).rejects.toThrow("simulated git clone failure"),
          );

          expect(yield* pathExists(targetDir)).toBe(false);
        }),
      ));

    it("should remove a newly cloned checkout when dependency installation fails", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const source = "git:github.com/user/repo";
          const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
          vi.spyOn(packageManager as any, "runCommand").mockImplementation(
            (...callArgs: unknown[]) =>
              effectRunPromise(
                Effect.sync(() => {
                  const [command, args] = callArgs as [string, string[]];
                  if (command === "git" && args[0] === "clone") {
                    nodeFs.mkdirSync(targetDir, { recursive: true });
                    writeJsonFileSync({
                      file: joinPath(targetDir, "package.json"),
                      value: { name: "repo", version: "1.0.0" },
                    });
                    return;
                  }
                  if (command === "npm") {
                    throw new Error("simulated dependency install failure");
                  }
                }),
              ),
          );

          yield* awaited(
            expect(packageManager.install(source)).rejects.toThrow(
              "simulated dependency install failure",
            ),
          );

          expect(yield* pathExists(targetDir)).toBe(false);
        }),
      ));

    it("should reconcile an existing git checkout to a pinned ref during install", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const source = "git:github.com/user/repo@v2";
          const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
          yield* makeDirectory(targetDir);
          yield* writeTextFile(
            joinPath(targetDir, "package.json"),
            yield* toJsonText({ name: "repo", version: "1.0.0" }),
          );

          const managerWithInternals = packageManager as unknown as PackageManagerInternals;
          vi.spyOn(managerWithInternals, "runCommandCapture").mockImplementation((_command, args) =>
            effectRunPromise(
              Effect.gen(function* () {
                if (args[0] === "rev-parse" && args[1] === "HEAD") {
                  return yield* awaited("old-head");
                }
                if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD^{commit}") {
                  return yield* awaited("new-head");
                }
                throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
              }),
            ),
          );
          const runCommandSpy = vi
            .spyOn(managerWithInternals, "runCommand")
            .mockResolvedValue(undefined);

          yield* awaited(packageManager.install(source));

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
        }),
      ));

    it("should reconcile an existing git checkout to its update target when installing without a ref", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const source = "git:github.com/user/repo";
          const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
          const fetchArgs = [
            "fetch",
            "--prune",
            "--no-tags",
            "origin",
            "+refs/heads/main:refs/remotes/origin/main",
          ];
          yield* makeDirectory(targetDir);

          const managerWithInternals = packageManager as unknown as PackageManagerInternals;
          vi.spyOn(managerWithInternals, "getLocalGitUpdateTarget").mockResolvedValue({
            ref: "origin/HEAD",
            head: "new-head",
            fetchArgs,
          });
          vi.spyOn(managerWithInternals, "runCommandCapture").mockImplementation((_command, args) =>
            effectRunPromise(
              Effect.gen(function* () {
                if (args[0] === "rev-parse" && args[1] === "HEAD") {
                  return yield* awaited("old-head");
                }
                if (args[0] === "rev-parse" && args[1] === "origin/HEAD^{commit}") {
                  return yield* awaited("new-head");
                }
                throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
              }),
            ),
          );
          const runCommandSpy = vi
            .spyOn(managerWithInternals, "runCommand")
            .mockResolvedValue(undefined);

          yield* awaited(packageManager.install(source));

          expect(runCommandSpy).toHaveBeenCalledWith("git", fetchArgs, { cwd: targetDir });
          expect(runCommandSpy).toHaveBeenCalledWith(
            "git",
            ["reset", "--hard", "origin/HEAD^{commit}"],
            {
              cwd: targetDir,
            },
          );
          expect(runCommandSpy).toHaveBeenCalledWith("git", ["clean", "-fdx"], { cwd: targetDir });
        }),
      ));

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
