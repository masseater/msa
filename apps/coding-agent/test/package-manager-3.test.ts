import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { nodeFs, packagePaths } from "./package-manager-support.ts";
import { Effect } from "effect";
import { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, toJsonText, writeTextFile } from "@msa/testing";
import { readEnv } from "../src/core/process-env.ts";

describe("DefaultPackageManager", () => {
  let tempDir: string;

  let agentDir: string;

  let settingsManager: SettingsManager;

  let packageManager: DefaultPackageManager;

  let previousOfflineEnv: string | undefined;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        previousOfflineEnv = readEnv("MSA_OFFLINE");
        vi.stubEnv("MSA_OFFLINE", undefined);
        tempDir = yield* makeTempDir("pm-test-");
        agentDir = joinPath(tempDir, "agent");
        yield* makeDirectory(agentDir);

        settingsManager = SettingsManager.inMemory();
        packageManager = new DefaultPackageManager({
          cwd: tempDir,
          agentDir,
          settingsManager,
        });
      }),
    ),
  );

  afterEach(() => {
    vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    return runTest(removePath(tempDir));
  });

  describe(".agents/skills auto-discovery", () => {
    it("should ignore root markdown files in .agents/skills but discover nested markdown skills", () => runTest(
Effect.gen(function* () {

      const agentsSkillsDir = joinPath(tempDir, ".agents", "skills");
      (yield* makeDirectory(joinPath(agentsSkillsDir, "nested-skill")));
      (yield* makeDirectory(joinPath(agentsSkillsDir, "third-party")));
      (yield* makeDirectory(joinPath(agentsSkillsDir, "third-party", "vendor", "pack")));
      const rootSkill = joinPath(agentsSkillsDir, "root-file.md");
      const nestedSkill = joinPath(agentsSkillsDir, "nested-skill", "SKILL.md");
      const nestedMarkdownSkill = joinPath(agentsSkillsDir, "third-party", "child-skill.md");
      const deeplyNestedMarkdownSkill = joinPath(
        agentsSkillsDir,
        "third-party",
        "vendor",
        "pack",
        "deep-skill.md",
      );
      (yield* writeTextFile(rootSkill, "---\nname: root-file\ndescription: Root markdown file\n---\n"));
      (yield* writeTextFile(nestedSkill, "---\nname: nested-skill\ndescription: Nested skill\n---\n"));
      (yield* writeTextFile(nestedMarkdownSkill, "---\nname: child-skill\ndescription: Nested markdown skill\n---\n"));
      (yield* writeTextFile(deeplyNestedMarkdownSkill, "---\nname: deep-skill\ndescription: Deep markdown skill\n---\n"));

      const pm = new DefaultPackageManager({
        cwd: joinPath(tempDir, "work"),
        agentDir,
        settingsManager,
      });
      (yield* makeDirectory(joinPath(tempDir, "work")));

      const result = (yield* awaited(pm.resolve()));
      expect(result.skills.some((r) => r.path === rootSkill)).toBe(false);
      expect(result.skills.some((r) => r.path === nestedSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedMarkdownSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === deeplyNestedMarkdownSkill && r.enabled)).toBe(
        true,
      );
    
}),
));

    it("should keep ~/.agents/skills user-scoped when cwd is under home in a non-git directory", () => runTest(
Effect.gen(function* () {

      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", tempDir);

      try {
        const cwd = joinPath(tempDir, "scratch", "nested");
        const localAgentDir = joinPath(tempDir, ".msa", "agent");
        const localSettingsManager = SettingsManager.inMemory();
        (yield* makeDirectory(cwd));
        (yield* makeDirectory(localAgentDir));

        const homeSkill = joinPath(tempDir, ".agents", "skills", "home-skill", "SKILL.md");
        (yield* makeDirectory(joinPath(tempDir, ".agents", "skills", "home-skill")));
        (yield* writeTextFile(homeSkill, "---\nname: home-skill\ndescription: home\n---\n"));

        const pm = new DefaultPackageManager({
          cwd,
          agentDir: localAgentDir,
          settingsManager: localSettingsManager,
        });

        const result = (yield* awaited(pm.resolve()));
        const matchingSkills = result.skills.filter((r) => r.path === homeSkill);
        expect(matchingSkills).toHaveLength(1);
        expect(matchingSkills[0]?.enabled).toBe(true);
        expect(matchingSkills[0]?.metadata.scope).toBe("user");
        expect(matchingSkills[0]?.metadata.source).toBe("auto");
      } finally {
        if (previousHome === undefined) {
          vi.stubEnv("HOME", undefined);
        } else {
          vi.stubEnv("HOME", previousHome);
        }
      }
    
}),
));

    it("should dedupe user skill entries when ~/.msa/agent/skills is a symlink to ~/.agents/skills", () => runTest(
Effect.gen(function* () {

      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", tempDir);

      try {
        const agentSkillsDir = joinPath(agentDir, "skills");
        const agentsSkillsDir = joinPath(tempDir, ".agents", "skills");
        (yield* makeDirectory(agentsSkillsDir));

        const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
        nodeFs.symlinkSync(agentsSkillsDir, agentSkillsDir, directoryLinkType);

        const skillPath = joinPath(agentsSkillsDir, "foo", "SKILL.md");
        (yield* makeDirectory(joinPath(agentsSkillsDir, "foo")));
        (yield* writeTextFile(skillPath, "---\nname: foo\ndescription: foo\n---\n"));

        const result = (yield* awaited(packageManager.resolve()));
        const fooSkills = result.skills.filter((r) => packagePaths.pathEndsWith(r.path, "foo/SKILL.md"));

        expect(fooSkills).toHaveLength(1);
      } finally {
        if (previousHome === undefined) {
          vi.stubEnv("HOME", undefined);
        } else {
          vi.stubEnv("HOME", previousHome);
        }
      }
    
}),
));
  });

  describe("ignore files", () => {
    it("should respect .gitignore in skill directories", () => runTest(
Effect.gen(function* () {

      const skillsDir = joinPath(agentDir, "skills");
      (yield* makeDirectory(skillsDir));
      (yield* writeTextFile(joinPath(skillsDir, ".gitignore"), "venv\n__pycache__\n"));

      const goodSkillDir = joinPath(skillsDir, "good-skill");
      (yield* makeDirectory(goodSkillDir));
      (yield* writeTextFile(joinPath(goodSkillDir, "SKILL.md"), "---\nname: good-skill\ndescription: Good\n---\nContent"));

      const ignoredSkillDir = joinPath(skillsDir, "venv", "bad-skill");
      (yield* makeDirectory(ignoredSkillDir));
      (yield* writeTextFile(joinPath(ignoredSkillDir, "SKILL.md"), "---\nname: bad-skill\ndescription: Bad\n---\nContent"));

      settingsManager.setSkillPaths(["skills"]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.skills.some((r) => r.path.includes("good-skill") && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path.includes("venv") && r.enabled)).toBe(false);
    
}),
));

    it("should not apply parent .gitignore to .msa auto-discovery", () => runTest(
Effect.gen(function* () {

      (yield* writeTextFile(joinPath(tempDir, ".gitignore"), ".msa\n"));

      const skillDir = joinPath(tempDir, ".msa", "skills", "auto-skill");
      (yield* makeDirectory(skillDir));
      const skillPath = joinPath(skillDir, "SKILL.md");
      (yield* writeTextFile(skillPath, "---\nname: auto-skill\ndescription: Auto\n---\nContent"));

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.skills.some((r) => r.path === skillPath && r.enabled)).toBe(true);
    
}),
));
  });

  describe("resolveExtensionSources", () => {
    it("should resolve local paths", () => runTest(
Effect.gen(function* () {

      const extPath = joinPath(tempDir, "ext.ts");
      (yield* writeTextFile(extPath, "export default function() {}"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([extPath])));
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    
}),
));

    it("should handle directories with msa manifest", () => runTest(
Effect.gen(function* () {

      const pkgDir = joinPath(tempDir, "my-package");
      (yield* makeDirectory(pkgDir));
      (yield* writeTextFile(joinPath(pkgDir, "package.json"), (yield* toJsonText({
          name: "my-package",
          msa: {
            extensions: ["./src/index.ts"],
            skills: ["./skills"],
          },
        }))));
      (yield* makeDirectory(joinPath(pkgDir, "src")));
      (yield* writeTextFile(joinPath(pkgDir, "src", "index.ts"), "export default function() {}"));
      (yield* makeDirectory(joinPath(pkgDir, "skills", "my-skill")));
      (yield* writeTextFile(joinPath(pkgDir, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\ndescription: Test\n---\nContent"));

      const result = (yield* awaited(packageManager.resolveExtensionSources([pkgDir])));
      expect(
        result.extensions.some((r) => r.path === joinPath(pkgDir, "src", "index.ts") && r.enabled),
      ).toBe(true);

      expect(
        result.skills.some(
          (r) => r.path === joinPath(pkgDir, "skills", "my-skill", "SKILL.md") && r.enabled,
        ),
      ).toBe(true);
    
}),
));
  });
});
