import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const installedUserPath = (source: string) =>
  Effect.promise(() => fixture.packageManager.configured.getInstalledPath(source, "user"));

const usePnpmCommand = () =>
  Effect.sync(() => {
    fixture.useSettings({
      npmCommand: ["pnpm"],
      packages: ["npm:pnpm-pkg"],
    });
  });

const shouldLoadLegacyPnpmGlobalPackagePaths = () =>
  runTest(
    Effect.gen(function* () {
      yield* usePnpmCommand();

      const pnpmRoot = joinPath(fixture.tempDir, "pnpm", "global", "v11");
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

      const result = yield* awaited(fixture.packageManager.resolution.resolve());

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
  fixture.useSettings({
    npmCommand: ["mise", "exec", "node@20", "--", "pnpm"],
  });

  const pnpmRoot = joinPath(fixture.tempDir, "pnpm", "global", "v11");
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
  fixture.useSettings({
    npmCommand: ["pnpm"],
  });

  vi.spyOn(commandRunner, "runCommandSync").mockReturnValue("not json");

  expect(yield* installedUserPath("npm:pnpm-pkg")).toBeUndefined();
});

describe("DefaultPackageManager", () => {
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
