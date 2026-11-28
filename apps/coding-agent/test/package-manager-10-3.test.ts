import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldSupportGlobPatternsInManifestExtensions = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "manifest-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "node_modules/dep/extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "local.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "node_modules/dep/extensions", "remote.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "node_modules/dep/extensions", "skip.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["extensions", "node_modules/dep/extensions", "!**/skip.ts"],
          },
          name: "manifest-pkg",
        }),
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "local.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "remote.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "skip.ts"))).toBe(
        false,
      );
    }),
  );

const shouldSupportGlobPatternsInManifestSkills = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "skill-manifest-pkg");
      yield* makeDirectory(joinPath(pkgDir, "skills/good-skill"));
      yield* makeDirectory(joinPath(pkgDir, "skills/bad-skill"));
      yield* writeTextFile(
        joinPath(pkgDir, "skills/good-skill", "SKILL.md"),
        "---\nname: good-skill\ndescription: Good\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "skills/bad-skill", "SKILL.md"),
        "---\nname: bad-skill\ndescription: Bad\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            skills: ["skills", "!**/bad-skill"],
          },
          name: "skill-manifest-pkg",
        }),
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );
      expect(result.skills.some((r) => packagePaths.isEnabled(r, "good-skill", "includes"))).toBe(
        true,
      );
      expect(result.skills.some((r) => r.path.includes("bad-skill"))).toBe(false);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("pattern filtering in msa manifest", () => {
    it(
      "should support glob patterns in manifest extensions",
      shouldSupportGlobPatternsInManifestExtensions,
    );

    it(
      "should support glob patterns in manifest skills",
      shouldSupportGlobPatternsInManifestSkills,
    );
  });
});
