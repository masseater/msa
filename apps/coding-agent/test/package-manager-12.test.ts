import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, relativePath, runTest, toJsonText, writeTextFile } =
  testing;

const shouldWorkWithDirectPathsNoPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "direct-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "one.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "two.ts"),
        "export default function() {}",
      );

      fixture.settingsManager.resources.setPackages([
        {
          extensions: ["extensions/one.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "two.ts"))).toBe(true);
    }),
  );

const shouldResolveAutoloadDisabledProjectPackageEntries = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.agentDir, "npm", "node_modules", "msa-tools");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({ name: "msa-tools", version: "1.0.0" }),
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      fixture.settingsManager.resources.setPackages(["npm:msa-tools"]);
      fixture.settingsManager.resources.setProjectPackages([
        { autoload: false, extensions: ["-extensions/foo.ts"], source: "npm:msa-tools" },
      ]);
      const runCommandSpy = vi
        .spyOn(commandRunner, "runCommand")
        .mockRejectedValue(new Error("unexpected install"));

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      const states = Object.fromEntries(
        result.extensions.map((resource) => [
          resource.path,
          { enabled: resource.enabled, scope: resource.metadata.scope },
        ]),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
      expect(states[joinPath(pkgDir, "extensions", "foo.ts")]).toEqual({
        enabled: false,
        scope: "project",
      });
      expect(states[joinPath(pkgDir, "extensions", "bar.ts")]).toEqual({
        enabled: true,
        scope: "user",
      });
    }),
  );

const shouldResolveAutoloadDisabledPackageEntriesAs = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("HOME", fixture.tempDir);
      const pkgDir = joinPath(fixture.tempDir, "positive-only-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "skills", "foo"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(joinPath(pkgDir, "skills", "foo", "SKILL.md"), "# Foo\n");
      fixture.settingsManager.resources.setProjectPackages([
        {
          autoload: false,
          extensions: ["+extensions/foo.ts"],
          source: relativePath(joinPath(fixture.tempDir, ".msa"), pkgDir),
        },
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());

      expect(result.extensions.map((resource) => resource.path)).toEqual([
        joinPath(pkgDir, "extensions", "foo.ts"),
      ]);
      expect(result.skills).toEqual([]);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("pattern filtering in package filters", () => {
    it("should work with direct paths (no patterns)", shouldWorkWithDirectPathsNoPatterns);

    it(
      "should resolve autoload-disabled project package entries as deltas over global packages",
      shouldResolveAutoloadDisabledProjectPackageEntries,
    );

    it(
      "should resolve autoload-disabled package entries as positive-only without a global package",
      shouldResolveAutoloadDisabledPackageEntriesAs,
    );
  });
});
