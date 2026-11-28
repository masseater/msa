import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { writeSkill } = packageManagerSupport;

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldRespectGitignoreInSkillDirectories = () =>
  runTest(
    Effect.gen(function* () {
      const skillsDir = joinPath(fixture.agentDir, "skills");
      yield* makeDirectory(skillsDir);
      yield* writeTextFile(joinPath(skillsDir, ".gitignore"), "venv\n__pycache__\n");

      const goodSkillDir = joinPath(skillsDir, "good-skill");
      yield* makeDirectory(goodSkillDir);
      yield* writeSkill(joinPath(goodSkillDir, "SKILL.md"), "good-skill", "Good");

      const ignoredSkillDir = joinPath(skillsDir, "venv", "bad-skill");
      yield* makeDirectory(ignoredSkillDir);
      yield* writeSkill(joinPath(ignoredSkillDir, "SKILL.md"), "bad-skill", "Bad");

      fixture.settingsManager.resources.setSkillPaths(["skills"]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.skills.some((r) => r.path.includes("good-skill") && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path.includes("venv") && r.enabled)).toBe(false);
    }),
  );

const shouldNotApplyParentGitignoreToMsa = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(fixture.tempDir, ".gitignore"), ".msa\n");

      const skillDir = joinPath(fixture.tempDir, ".msa", "skills", "auto-skill");
      yield* makeDirectory(skillDir);
      const skillPath = joinPath(skillDir, "SKILL.md");
      yield* writeSkill(skillPath, "auto-skill", "Auto");

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.skills.some((r) => r.path === skillPath && r.enabled)).toBe(true);
    }),
  );

const shouldResolveLocalPaths = () =>
  runTest(
    Effect.gen(function* () {
      const extPath = joinPath(fixture.tempDir, "ext.ts");
      yield* writeTextFile(extPath, "export default function() {}");

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([extPath]),
      );
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    }),
  );

const shouldHandleDirectoriesWithMsaManifest = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "my-package");
      yield* makeDirectory(pkgDir);
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["./src/index.ts"],
            skills: ["./skills"],
          },
          name: "my-package",
        }),
      );
      yield* makeDirectory(joinPath(pkgDir, "src"));
      yield* writeTextFile(joinPath(pkgDir, "src", "index.ts"), "export default function() {}");
      yield* makeDirectory(joinPath(pkgDir, "skills", "my-skill"));
      yield* writeSkill(joinPath(pkgDir, "skills", "my-skill", "SKILL.md"), "my-skill", "Test");

      const result = yield* awaited(
        fixture.packageManager.resolution.resolveExtensionSources([pkgDir]),
      );
      expect(
        result.extensions.some((r) => r.path === joinPath(pkgDir, "src", "index.ts") && r.enabled),
      ).toBe(true);

      expect(
        result.skills.some(
          (r) => r.path === joinPath(pkgDir, "skills", "my-skill", "SKILL.md") && r.enabled,
        ),
      ).toBe(true);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("ignore files", () => {
    it("should respect .gitignore in skill directories", shouldRespectGitignoreInSkillDirectories);

    it(
      "should not apply parent .gitignore to .msa auto-discovery",
      shouldNotApplyParentGitignoreToMsa,
    );
  });

  describe("resolveExtensionSources", () => {
    it("should resolve local paths", shouldResolveLocalPaths);

    it("should handle directories with msa manifest", shouldHandleDirectoriesWithMsaManifest);
  });
});
