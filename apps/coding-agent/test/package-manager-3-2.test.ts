import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
const { readEnv } = processEnv;

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

let previousOfflineEnv: string | undefined;

const shouldRespectGitignoreInSkillDirectories = () =>
  runTest(
    Effect.gen(function* () {
      const skillsDir = joinPath(agentDir, "skills");
      yield* makeDirectory(skillsDir);
      yield* writeTextFile(joinPath(skillsDir, ".gitignore"), "venv\n__pycache__\n");

      const goodSkillDir = joinPath(skillsDir, "good-skill");
      yield* makeDirectory(goodSkillDir);
      yield* writeTextFile(
        joinPath(goodSkillDir, "SKILL.md"),
        "---\nname: good-skill\ndescription: Good\n---\nContent",
      );

      const ignoredSkillDir = joinPath(skillsDir, "venv", "bad-skill");
      yield* makeDirectory(ignoredSkillDir);
      yield* writeTextFile(
        joinPath(ignoredSkillDir, "SKILL.md"),
        "---\nname: bad-skill\ndescription: Bad\n---\nContent",
      );

      settingsManager.resources.setSkillPaths(["skills"]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.skills.some((r) => r.path.includes("good-skill") && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path.includes("venv") && r.enabled)).toBe(false);
    }),
  );

const shouldNotApplyParentGitignoreToMsa = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(tempDir, ".gitignore"), ".msa\n");

      const skillDir = joinPath(tempDir, ".msa", "skills", "auto-skill");
      yield* makeDirectory(skillDir);
      const skillPath = joinPath(skillDir, "SKILL.md");
      yield* writeTextFile(skillPath, "---\nname: auto-skill\ndescription: Auto\n---\nContent");

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.skills.some((r) => r.path === skillPath && r.enabled)).toBe(true);
    }),
  );

const shouldResolveLocalPaths = () =>
  runTest(
    Effect.gen(function* () {
      const extPath = joinPath(tempDir, "ext.ts");
      yield* writeTextFile(extPath, "export default function() {}");

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([extPath]));
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    }),
  );

const shouldHandleDirectoriesWithMsaManifest = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "my-package");
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
      yield* writeTextFile(
        joinPath(pkgDir, "skills", "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: Test\n---\nContent",
      );

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([pkgDir]));
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

const beforeEachHook2 = () =>
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

const afterEachHook2 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

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
