import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldApplyUserFiltersOnTopOf = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "layered-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "baz.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["extensions", "!**/baz.ts"],
          },
          name: "layered-pkg",
        }),
      );

      fixture.settingsManager.resources.setPackages([
        {
          extensions: ["!**/bar.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());

      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "foo.ts"))).toBe(true);

      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "bar.ts"))).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "baz.ts"))).toBe(
        false,
      );
    }),
  );

const shouldExcludeExtensionsFromPackageWithPattern = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "pattern-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "baz.ts"),
        "export default function() {}",
      );

      fixture.settingsManager.resources.setPackages([
        {
          extensions: ["!**/baz.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "foo.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "bar.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "baz.ts"))).toBe(true);
    }),
  );

const shouldFilterThemesFromPackage = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "theme-pkg");
      yield* makeDirectory(joinPath(pkgDir, "themes"));
      yield* writeTextFile(joinPath(pkgDir, "themes", "nice.json"), "{}");
      yield* writeTextFile(joinPath(pkgDir, "themes", "ugly.json"), "{}");

      fixture.settingsManager.resources.setPackages([
        {
          extensions: [],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: ["!ugly.json"],
        },
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "nice.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "ugly.json"))).toBe(true);
    }),
  );

const shouldCombineIncludeAndExcludePatterns = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "combo-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "alpha.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "beta.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "gamma.ts"),
        "export default function() {}",
      );

      fixture.settingsManager.resources.setPackages([
        {
          extensions: ["**/alpha.ts", "**/beta.ts", "!**/beta.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "beta.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "gamma.ts"))).toBe(true);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("pattern filtering in package filters", () => {
    it(
      "should apply user filters on top of manifest filters (not replace)",
      shouldApplyUserFiltersOnTopOf,
    );

    it(
      "should exclude extensions from package with ! pattern",
      shouldExcludeExtensionsFromPackageWithPattern,
    );

    it("should filter themes from package", shouldFilterThemesFromPackage);

    it("should combine include and exclude patterns", shouldCombineIncludeAndExcludePatterns);
  });
});
