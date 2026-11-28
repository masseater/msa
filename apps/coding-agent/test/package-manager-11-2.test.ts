import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerScenario from "./package-manager-scenario.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { filesOf, resolves } = packageManagerScenario;

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

const scenarios = [
  {
    name: "should exclude extensions from package with ! pattern",
    scenario: {
      disabled: ["baz.ts"],
      enabled: ["foo.ts", "bar.ts"],
      files: filesOf(
        ["extensions/foo.ts", "extensions/bar.ts", "extensions/baz.ts"],
        "export default function() {}",
      ),
      kind: "extensions",
      patterns: ["!**/baz.ts"],
      where: { packageNamed: "pattern-pkg" },
    },
  },
  {
    name: "should filter themes from package",
    scenario: {
      disabled: ["ugly.json"],
      enabled: ["nice.json"],
      files: filesOf(["themes/nice.json", "themes/ugly.json"], "{}"),
      kind: "themes",
      patterns: ["!ugly.json"],
      where: { packageNamed: "theme-pkg" },
    },
  },
  {
    name: "should combine include and exclude patterns",
    scenario: {
      disabled: ["beta.ts", "gamma.ts"],
      enabled: ["alpha.ts"],
      files: filesOf(
        ["extensions/alpha.ts", "extensions/beta.ts", "extensions/gamma.ts"],
        "export default function() {}",
      ),
      kind: "extensions",
      patterns: ["**/alpha.ts", "**/beta.ts", "!**/beta.ts"],
      where: { packageNamed: "combo-pkg" },
    },
  },
] as const;

describe("DefaultPackageManager", () => {
  describe("pattern filtering in package filters", () => {
    it(
      "should apply user filters on top of manifest filters (not replace)",
      shouldApplyUserFiltersOnTopOf,
    );

    for (const { name, scenario } of scenarios) {
      it(name, () => runTest(resolves(fixture, scenario)));
    }
  });
});
