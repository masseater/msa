import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
const { readEnv } = platform;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

const installedUserPath = (source: string) =>
  Effect.promise(() => packageManager.configured.getInstalledPath(source, "user"));

let previousOfflineEnv: string | undefined;

const usePnpmCommand = () =>
  Effect.sync(() => {
    settingsManager = SettingsManager.inMemory({
      npmCommand: ["pnpm"],
      packages: ["npm:pnpm-pkg"],
    });
    packageManager = new DefaultPackageManager({
      agentDir,
      cwd: tempDir,
      settingsManager,
    });
  });

const shouldLoadLegacyPnpmGlobalPackagePaths = () =>
  runTest(
    Effect.gen(function* () {
      yield* usePnpmCommand();

      const pnpmRoot = joinPath(tempDir, "pnpm", "global", "v11");
      const packagePath = joinPath(pnpmRoot, "20-hash", "node_modules", "pnpm-pkg");
      yield* makeDirectory(joinPath(packagePath, "extensions"));
      yield* writeTextFile(
        joinPath(packagePath, "package.json"),
        yield* toJsonText({ name: "pnpm-pkg", version: "1.0.0" }),
      );
      yield* writeTextFile(
        joinPath(packagePath, "extensions", "index.ts"),
        "export default function() {};",
      );

      vi.spyOn(commandRunner, "runCommandSync").mockImplementation((...callArgs: unknown[]) => {
        const [command, args] = callArgs as [string, string[]];
        if (command !== "pnpm") {
          throw new Error(`unexpected command ${command}`);
        }
        if (args.join(" ") === "list -g --depth 0 --json") {
          return JSON.stringify([
            {
              dependencies: { "pnpm-pkg": { path: packagePath, version: "1.0.0" } },
              path: pnpmRoot,
            },
          ]);
        }
        throw new Error(`unexpected args ${args.join(" ")}`);
      });
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      const result = yield* awaited(packageManager.resolution.resolve());

      expect(
        result.extensions.some(
          (r) => r.path === joinPath(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(runCommandSpy).not.toHaveBeenCalled();
      expect(yield* installedUserPath("npm:pnpm-pkg")).toBe(packagePath);
    }),
  );

const shouldResolveWrappedPnpmGlobalPackagePaths = Effect.gen(function* () {
  settingsManager = SettingsManager.inMemory({
    npmCommand: ["mise", "exec", "node@20", "--", "pnpm"],
  });
  packageManager = new DefaultPackageManager({
    agentDir,
    cwd: tempDir,
    settingsManager,
  });

  const pnpmRoot = joinPath(tempDir, "pnpm", "global", "v11");
  const packagePath = joinPath(pnpmRoot, "20-hash", "node_modules", "pnpm-pkg");
  yield* makeDirectory(packagePath);

  vi.spyOn(commandRunner, "runCommandSync").mockImplementation((...callArgs: unknown[]) => {
    const [command, args] = callArgs as [string, string[]];
    expect(command).toBe("mise");
    if (args.join(" ") === "exec node@20 -- pnpm list -g --depth 0 --json") {
      return JSON.stringify([
        { dependencies: { "pnpm-pkg": { path: packagePath } }, path: pnpmRoot },
      ]);
    }
    throw new Error(`unexpected args ${args.join(" ")}`);
  });

  expect(yield* installedUserPath("npm:pnpm-pkg")).toBe(packagePath);
});

const shouldIgnoreMalformedLegacyPnpmGlobalPackage = Effect.gen(function* () {
  settingsManager = SettingsManager.inMemory({
    npmCommand: ["pnpm"],
  });
  packageManager = new DefaultPackageManager({
    agentDir,
    cwd: tempDir,
    settingsManager,
  });

  vi.spyOn(commandRunner, "runCommandSync").mockReturnValue("not json");

  expect(yield* installedUserPath("npm:pnpm-pkg")).toBeUndefined();
});

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      previousOfflineEnv = readEnv("MSA_OFFLINE");
      vi.stubEnv("MSA_OFFLINE", undefined);
      tempDir = yield* makeTempDir("pm-test-");
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

const afterEachHook = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("npmCommand", () => {
    it(
      "should load legacy pnpm global package paths from pnpm list output",
      shouldLoadLegacyPnpmGlobalPackagePaths,
    );

    it("should resolve wrapped pnpm global package paths from pnpm list output", () =>
      runTest(shouldResolveWrappedPnpmGlobalPackagePaths));

    it("should ignore malformed legacy pnpm global package lists", () =>
      runTest(shouldIgnoreMalformedLegacyPnpmGlobalPackage));
  });
});
