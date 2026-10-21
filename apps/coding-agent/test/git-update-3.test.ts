import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import gitUpdateSupport from "./git-update-support.ts";
import parsedSource from "./parsed-source.ts";
import testNetworkEnv from "./test-network-env.ts";

const { asGit } = parsedSource;
const { getFileContent, gitSource } = gitUpdateSupport;

const { allowNetwork } = testNetworkEnv;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;
let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

const writeStaleGitCache = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const cachedDir = packageManager.git.paths.getGitInstallPath(
      asGit(packageManager.sources.parseSource(gitSource)),
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

const beforeEachHook4 = () =>
  runTest(
    Effect.gen(function* () {
      allowNetwork();
      tempDir = joinPath(tmpdir(), `git-update-test-${currentTimeMillis()}-${randomSuffixSync()}`);
      yield* makeDirectory(tempDir);
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(agentDir);
      settingsManager = SettingsManager.inMemory();
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });
    }),
  );

const afterEachHook4 = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
        yield* removePath(tempDir);
      }
    }),
  );

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
        packageManager.resolution.resolveExtensionSources([gitSource], { temporary: true }),
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
  beforeEach(beforeEachHook4);

  afterEach(afterEachHook4);

  describe("temporary git sources", () => {
    it(
      "should refresh cached temporary git sources when resolving",
      shouldRefreshCachedTemporaryGitSourcesWhen,
    );
  });
});
