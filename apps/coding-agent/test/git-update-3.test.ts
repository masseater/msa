import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import gitUpdateSupport from "./git-update-support.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import parsedSource from "./parsed-source.ts";

const { asGit } = parsedSource;
const { getFileContent, gitSource } = gitUpdateSupport;

const { awaited, joinPath, makeDirectory, removePath, runTest, toJsonText, writeTextFile } =
  testing;
const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const writeStaleGitCache = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const cachedDir = fixture.packageManager.git.paths.getGitInstallPath(
      asGit(fixture.packageManager.sources.parseSource(gitSource)),
      "temporary",
    );
    const extensionFile = joinPath(cachedDir, "msa-extensions", "session-breakdown.ts");

    yield* removePath(cachedDir);
    yield* makeDirectory(joinPath(cachedDir, "msa-extensions"));
    yield* writeTextFile(
      joinPath(cachedDir, "package.json"),
      yield* toJsonText({ msa: { extensions: ["./msa-extensions"] } }),
    );
    yield* writeTextFile(extensionFile, "// stale");
    return { cachedDir, effectRunPromise, extensionFile };
  });

const shouldRefreshCachedTemporaryGitSourcesWhen = () =>
  runTest(
    Effect.gen(function* () {
      const { cachedDir, effectRunPromise, extensionFile } = yield* writeStaleGitCache();

      const executedCommands: string[] = [];
      commandRunner.runCommand = (command, args) =>
        effectRunPromise(
          Effect.gen(function* () {
            executedCommands.push(`${command} ${args.join(" ")}`);
            if (command === "git" && args[0] === "reset") {
              yield* writeTextFile(extensionFile, "// fresh");
            }
          }),
        );
      commandRunner.runCommandCapture = (_command, args) =>
        effectRunPromise(
          Effect.gen(function* () {
            if (args[0] === "rev-parse" && args[1] === "HEAD") {
              return yield* awaited("local-head");
            }
            if (args[0] === "rev-parse" && args[1] === "@{upstream}") {
              return yield* awaited("remote-head");
            }
            if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
              return yield* awaited("origin/main");
            }
            return yield* awaited("");
          }),
        );

      yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([gitSource], { temporary: true }),
      );

      expect(executedCommands).toContain(
        "git fetch --prune --no-tags origin +refs/heads/main:refs/remotes/origin/main",
      );
      expect(yield* getFileContent(cachedDir, "msa-extensions/session-breakdown.ts")).toBe(
        "// fresh",
      );
    }),
  );

describe("DefaultPackageManager git update", () => {
  describe("temporary git sources", () => {
    it(
      "should refresh cached temporary git sources when resolving",
      shouldRefreshCachedTemporaryGitSourcesWhen,
    );
  });
});
