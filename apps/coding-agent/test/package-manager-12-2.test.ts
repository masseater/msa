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

const SOURCE = "export default function() {}";
const skillOf = (name: string, label: string) =>
  `---\nname: ${name}\ndescription: ${label}\n---\nContent`;

const scenarios = [
  {
    name: "should force-include extensions with + pattern after exclusion",
    scenario: {
      disabled: ["keep.ts", "excluded.ts"],
      enabled: ["force-back.ts"],
      files: filesOf(
        ["extensions/keep.ts", "extensions/excluded.ts", "extensions/force-back.ts"],
        SOURCE,
      ),
      kind: "extensions",
      patterns: ["extensions", "!extensions/*.ts", "+extensions/force-back.ts"],
      where: { agent: true },
    },
  },
  {
    name: "should force-include overrides exclude in package filters",
    scenario: {
      disabled: ["alpha.ts", "gamma.ts"],
      enabled: ["beta.ts"],
      files: filesOf(["extensions/alpha.ts", "extensions/beta.ts", "extensions/gamma.ts"], SOURCE),
      kind: "extensions",
      patterns: ["!**/*.ts", "+extensions/beta.ts"],
      where: { packageNamed: "force-pkg" },
    },
  },
  {
    name: "should force-include multiple resources",
    scenario: {
      disabled: ["skill-b"],
      enabled: ["skill-a", "skill-c"],
      files: {
        "skills/skill-a/SKILL.md": skillOf("skill-a", "A"),
        "skills/skill-b/SKILL.md": skillOf("skill-b", "B"),
        "skills/skill-c/SKILL.md": skillOf("skill-c", "C"),
      },
      kind: "skills",
      match: "includes",
      patterns: ["!**/*", "+skills/skill-a", "+skills/skill-c"],
      where: { packageNamed: "multi-force-pkg" },
    },
  },
  {
    name: "should force-include after specific exclusion",
    scenario: {
      enabled: ["a.ts", "b.ts"],
      files: filesOf(["extensions/a.ts", "extensions/b.ts"], SOURCE),
      kind: "extensions",
      patterns: ["extensions", "!extensions/b.ts", "+extensions/b.ts"],
      where: { agent: true },
    },
  },
] as const;

const shouldHandleForceIncludeInManifestPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "manifest-force-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "one.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "two.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "three.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["extensions", "!**/two.ts", "+extensions/two.ts"],
          },
          name: "manifest-force-pkg",
        }),
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "two.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "three.ts"))).toBe(true);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("force-include patterns", () => {
    for (const { name, scenario } of scenarios) {
      it(name, () => runTest(resolves(fixture, scenario)));
    }

    it(
      "should handle force-include in manifest patterns",
      shouldHandleForceIncludeInManifestPatterns,
    );
  });
});
