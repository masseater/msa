import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import gitRemote from "../src/core/package-manager/git-remote.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldRepairMissingGitPackageDependenciesWhen = Effect.gen(function* () {
  const source = "git:github.com/user/repo";
  const targetDir = joinPath(fixture.agentDir, "git", "github.com", "user", "repo");
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
      dependencies: { dependency: "1.0.0" },
      name: "repo",
      version: "1.0.0",
    }),
  );
  fixture.settingsManager.resources.setPackages([source]);
  vi.spyOn(gitRemote, "getLocalGitUpdateTarget").mockResolvedValue({
    fetchArgs,
    head: "current-head",
    ref: "@{upstream}",
  });
  vi.spyOn(commandRunner, "runCommandCapture").mockResolvedValue("current-head");
  const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

  yield* awaited(fixture.packageManager.operations.updates.update(source));

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
});

const shouldRepairDeletedGitPackageDependenciesWhenSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const source = "git:github.com/user/repo";
    const targetDir = joinPath(fixture.agentDir, "git", "github.com", "user", "repo");
    const fetchArgs = [
      "fetch",
      "--prune",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ];
    return { effectRunPromise, fetchArgs, source, targetDir };
  });

const shouldRepairDeletedGitPackageDependenciesWhen = Effect.gen(function* () {
  const { effectRunPromise, fetchArgs, source, targetDir } =
    yield* shouldRepairDeletedGitPackageDependenciesWhenSetup();
  yield* makeDirectory(targetDir);
  yield* writeTextFile(
    joinPath(targetDir, "package.json"),
    yield* toJsonText({
      dependencies: { dependency: "1.0.0" },
      name: "repo",
      version: "1.0.0",
    }),
  );
  fixture.settingsManager.resources.setPackages([source]);
  vi.spyOn(gitRemote, "getLocalGitUpdateTarget").mockResolvedValue({
    fetchArgs,
    head: "new-head",
    ref: "@{upstream}",
  });
  vi.spyOn(commandRunner, "runCommandCapture").mockImplementation((_command, args) =>
    effectRunPromise(awaited(args[1] === "HEAD" ? "old-head" : "new-head")),
  );
  const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockImplementation((_command, args) =>
    effectRunPromise(
      Effect.sync(() => {
        if (args[0] === "clean") throw new Error("simulated clean failure");
      }),
    ),
  );

  yield* awaited(
    expect(fixture.packageManager.operations.updates.update(source)).rejects.toThrow(
      "simulated clean failure",
    ),
  );

  expect(runCommandSpy).toHaveBeenCalledWith(
    "npm",
    ["install", "--omit=dev", "--legacy-peer-deps"],
    {
      cwd: targetDir,
    },
  );
});

describe("DefaultPackageManager", () => {
  describe("npmCommand", () => {
    it("should repair missing git package dependencies when the checkout is already current", () =>
      runTest(shouldRepairMissingGitPackageDependenciesWhen));

    it("should repair deleted git package dependencies when cleaning fails", () =>
      runTest(shouldRepairDeletedGitPackageDependenciesWhen));
  });
});
