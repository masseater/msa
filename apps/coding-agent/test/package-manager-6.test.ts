import {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
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
    it("should detect pnpm through a corepack wrapper without a separator", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          settingsManager = SettingsManager.inMemory({
            npmCommand: ["corepack", "pnpm"],
          });
          packageManager = new DefaultPackageManager({
            cwd: tempDir,
            agentDir,
            settingsManager,
          });

          const source = "git:github.com/user/repo";
          const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
          const runCommandSpy = vi
            .spyOn(packageManager as any, "runCommand")
            .mockImplementation((...callArgs: unknown[]) =>
              effectRunPromise(
                Effect.sync(() => {
                  const [command, args] = callArgs as [string, string[]];
                  if (command === "git" && args[0] === "clone") {
                    nodeFs.mkdirSync(targetDir, { recursive: true });
                    writeJsonFileSync({
                      file: joinPath(targetDir, "package.json"),
                      value: { name: "repo", version: "1.0.0" },
                    });
                  }
                }),
              ),
            );

          yield* awaited(packageManager.install(source));

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
        }),
      ));

    it("should disable peer installation for git package dependencies with bun", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          settingsManager = SettingsManager.inMemory({
            npmCommand: ["bun"],
          });
          packageManager = new DefaultPackageManager({
            cwd: tempDir,
            agentDir,
            settingsManager,
          });

          const source = "git:github.com/user/repo";
          const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
          const runCommandSpy = vi
            .spyOn(packageManager as any, "runCommand")
            .mockImplementation((...callArgs: unknown[]) =>
              effectRunPromise(
                Effect.sync(() => {
                  const [command, args] = callArgs as [string, string[]];
                  if (command === "git" && args[0] === "clone") {
                    nodeFs.mkdirSync(targetDir, { recursive: true });
                    writeJsonFileSync({
                      file: joinPath(targetDir, "package.json"),
                      value: { name: "repo", version: "1.0.0" },
                    });
                  }
                }),
              ),
            );

          yield* awaited(packageManager.install(source));

          expect(runCommandSpy).toHaveBeenCalledWith(
            "bun",
            ["install", "--omit=dev", "--omit=peer"],
            {
              cwd: targetDir,
            },
          );
        }),
      ));

    it("should update git package dependencies without auto-installing peers", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const source = "git:github.com/user/repo";
          const targetDir = joinPath(tempDir, ".msa", "git", "github.com", "user", "repo");
          yield* makeDirectory(targetDir);
          yield* writeTextFile(
            joinPath(targetDir, "package.json"),
            yield* toJsonText({ name: "repo", version: "1.0.0" }),
          );
          settingsManager.setProjectPackages([source]);

          vi.spyOn(packageManager as any, "runCommandCapture").mockImplementation(
            (...callArgs: unknown[]) =>
              effectRunPromise(
                Effect.gen(function* () {
                  const [_command, args] = callArgs as [string, string[]];
                  if (
                    args[0] === "rev-parse" &&
                    args[1] === "--abbrev-ref" &&
                    args[2] === "@{upstream}"
                  ) {
                    return yield* awaited("origin/main");
                  }
                  if (
                    args[0] === "rev-parse" &&
                    (args[1] === "@{upstream}" || args[1] === "@{upstream}^{commit}")
                  ) {
                    return yield* awaited("remote-head");
                  }
                  if (args[0] === "rev-parse" && args[1] === "HEAD") {
                    return yield* awaited("local-head");
                  }
                  throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
                }),
              ),
          );
          const runCommandSpy = vi
            .spyOn(packageManager as any, "runCommand")
            .mockResolvedValue(undefined);

          yield* awaited(packageManager.update(source));

          expect(runCommandSpy).toHaveBeenCalledWith(
            "npm",
            ["install", "--omit=dev", "--legacy-peer-deps"],
            {
              cwd: targetDir,
            },
          );
        }),
      ));

    it("should repair missing git package dependencies when the checkout is already current", () =>
      runTest(
        Effect.gen(function* () {
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
          yield* writeTextFile(
            joinPath(targetDir, "package.json"),
            yield* toJsonText({
              name: "repo",
              version: "1.0.0",
              dependencies: { dependency: "1.0.0" },
            }),
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

          yield* awaited(packageManager.update(source));

          expect(runCommandSpy).toHaveBeenCalledWith(
            "npm",
            ["install", "--omit=dev", "--legacy-peer-deps"],
            {
              cwd: targetDir,
            },
          );
          expect(runCommandSpy).not.toHaveBeenCalledWith("git", ["clean", "-fdx"], {
            cwd: targetDir,
          });
        }),
      ));

    it("should repair deleted git package dependencies when cleaning fails", () =>
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
          yield* writeTextFile(
            joinPath(targetDir, "package.json"),
            yield* toJsonText({
              name: "repo",
              version: "1.0.0",
              dependencies: { dependency: "1.0.0" },
            }),
          );
          settingsManager.setPackages([source]);

          const managerWithInternals = packageManager as unknown as PackageManagerInternals;
          vi.spyOn(managerWithInternals, "getLocalGitUpdateTarget").mockResolvedValue({
            ref: "@{upstream}",
            head: "new-head",
            fetchArgs,
          });
          vi.spyOn(managerWithInternals, "runCommandCapture").mockImplementation((_command, args) =>
            effectRunPromise(awaited(args[1] === "HEAD" ? "old-head" : "new-head")),
          );
          const runCommandSpy = vi
            .spyOn(managerWithInternals, "runCommand")
            .mockImplementation((_command, args) =>
              effectRunPromise(
                Effect.sync(() => {
                  if (args[0] === "clean") throw new Error("simulated clean failure");
                }),
              ),
            );

          yield* awaited(
            expect(packageManager.update(source)).rejects.toThrow("simulated clean failure"),
          );

          expect(runCommandSpy).toHaveBeenCalledWith(
            "npm",
            ["install", "--omit=dev", "--legacy-peer-deps"],
            {
              cwd: targetDir,
            },
          );
        }),
      ));
  });
});
