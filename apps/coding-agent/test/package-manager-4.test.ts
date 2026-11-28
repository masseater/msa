import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths, writeSkill } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldKeepMsaManifestEntriesWithLeading = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "tilde-manifest-package");
      const directExtensionPath = joinPath(pkgDir, "~extensions", "main.ts");
      const slashExtensionPath = joinPath(pkgDir, "~", "extensions", "alt.ts");
      const directSkillPath = joinPath(pkgDir, "~skills", "direct-skill", "SKILL.md");
      const slashSkillPath = joinPath(pkgDir, "~", "skills", "slash-skill", "SKILL.md");

      yield* makeDirectory(joinPath(pkgDir, "~extensions"));
      yield* makeDirectory(joinPath(pkgDir, "~", "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "~skills", "direct-skill"));
      yield* makeDirectory(joinPath(pkgDir, "~", "skills", "slash-skill"));
      yield* writeTextFile(directExtensionPath, "export default function() {}");
      yield* writeTextFile(slashExtensionPath, "export default function() {}");
      yield* writeSkill(directSkillPath, "direct-skill", "Direct");
      yield* writeSkill(slashSkillPath, "slash-skill", "Slash");
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["~extensions/main.ts", "~/extensions/alt.ts"],
            skills: ["~skills", "~/skills"],
          },
          name: "tilde-manifest-package",
        }),
      );

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );

      expect(result.extensions.some((r) => r.path === directExtensionPath && r.enabled)).toBe(true);
      expect(result.extensions.some((r) => r.path === slashExtensionPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === directSkillPath && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === slashSkillPath && r.enabled)).toBe(true);
    }),
  );

const shouldHandleDirectoriesWithAutoDiscoveryLayout = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "auto-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* makeDirectory(joinPath(pkgDir, "themes"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "main.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(joinPath(pkgDir, "themes", "dark.json"), "{}");

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );
      expect(
        result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "main.ts") && r.enabled),
      ).toBe(true);
      expect(
        result.themes.some((r) => packagePaths.pathEndsWith(r.path, "dark.json") && r.enabled),
      ).toBe(true);
    }),
  );

const shouldStopRecursingWhenAPackageSkill = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "skill-root-pkg");
      yield* makeDirectory(joinPath(pkgDir, "skills", "root-skill", "nested-skill"));
      const rootSkill = joinPath(pkgDir, "skills", "root-skill", "SKILL.md");
      const nestedSkill = joinPath(pkgDir, "skills", "root-skill", "nested-skill", "SKILL.md");
      yield* writeSkill(rootSkill, "root-skill", "Root skill", "");
      yield* writeSkill(nestedSkill, "nested-skill", "Nested skill", "");

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );
      expect(result.skills.some((r) => r.path === rootSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedSkill)).toBe(false);
    }),
  );

const shouldEmitProgressEvents = () =>
  runTest(
    Effect.gen(function* () {
      const events: packageManagerTypes.ProgressEvent[] = [];
      fixture.packageManager.progress.setProgressCallback((event) => events.push(event));

      const extPath = joinPath(fixture.tempDir, "ext.ts");
      yield* writeTextFile(extPath, "export default function() {}");

      yield* awaited(fixture.packageManager.resolution.resolveExtensionSources([extPath]));

      expect(events.length).toBe(0);
    }),
  );

const shouldPreserveArgvEntriesContainingSpaces = () => {
  const valueWithSpace = "C:\\Users\\A B\\.msa\\npm";
  const output = commandRunner.runCommandSync(process.execPath, [
    "-e",
    "console.log(process.argv[1])",
    valueWithSpace,
  ]);

  expect(output).toBe(valueWithSpace);
};

describe("DefaultPackageManager", () => {
  describe("resolveExtensionSources", () => {
    it(
      "should keep msa manifest entries with leading tilde package-relative",
      shouldKeepMsaManifestEntriesWithLeading,
    );

    it(
      "should handle directories with auto-discovery layout",
      shouldHandleDirectoriesWithAutoDiscoveryLayout,
    );

    it(
      "should stop recursing when a package skill directory contains SKILL.md",
      shouldStopRecursingWhenAPackageSkill,
    );
  });
});

describe("DefaultPackageManager", () => {
  describe("progress callback", () => {
    it("should emit progress events", shouldEmitProgressEvents);
  });

  describe("command spawning", () => {
    it("should preserve argv entries containing spaces", shouldPreserveArgvEntriesContainingSpaces);
  });
});
