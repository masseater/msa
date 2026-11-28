import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();
const { readEnv } = platform;

const { packagePaths, skillOf, writeSkill } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, makeSymlink, runTest, writeTextFile } = testing;

const shouldIgnoreRootMarkdownFilesInAgents = () =>
  runTest(
    Effect.gen(function* () {
      const agentsSkillsDir = joinPath(fixture.tempDir, ".agents", "skills");
      yield* makeDirectory(joinPath(agentsSkillsDir, "nested-skill"));
      yield* makeDirectory(joinPath(agentsSkillsDir, "third-party"));
      yield* makeDirectory(joinPath(agentsSkillsDir, "third-party", "vendor", "pack"));
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
      yield* writeTextFile(rootSkill, skillOf("root-file", "Root markdown file", ""));
      yield* writeTextFile(nestedSkill, skillOf("nested-skill", "Nested skill", ""));
      yield* writeTextFile(
        nestedMarkdownSkill,
        skillOf("child-skill", "Nested markdown skill", ""),
      );
      yield* writeTextFile(
        deeplyNestedMarkdownSkill,
        skillOf("deep-skill", "Deep markdown skill", ""),
      );

      const pm = new DefaultPackageManager({
        agentDir: fixture.agentDir,
        cwd: joinPath(fixture.tempDir, "work"),
        settingsManager: fixture.settingsManager,
      });
      yield* makeDirectory(joinPath(fixture.tempDir, "work"));

      const result = yield* awaited(pm.resolution.resolve());
      expect(result.skills.some((r) => r.path === rootSkill)).toBe(false);
      expect(result.skills.some((r) => r.path === nestedSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === nestedMarkdownSkill && r.enabled)).toBe(true);
      expect(result.skills.some((r) => r.path === deeplyNestedMarkdownSkill && r.enabled)).toBe(
        true,
      );
    }),
  );

const shouldKeepAgentsSkillsUserScopedWhen = () =>
  runTest(
    Effect.gen(function* () {
      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", fixture.tempDir);

      try {
        const cwd = joinPath(fixture.tempDir, "scratch", "nested");
        const localAgentDir = joinPath(fixture.tempDir, ".msa", "agent");
        const localSettingsManager = SettingsManager.inMemory();
        yield* makeDirectory(cwd);
        yield* makeDirectory(localAgentDir);

        const homeSkill = joinPath(fixture.tempDir, ".agents", "skills", "home-skill", "SKILL.md");
        yield* writeSkill(homeSkill, "home-skill", "home", "");

        const pm = new DefaultPackageManager({
          agentDir: localAgentDir,
          cwd,
          settingsManager: localSettingsManager,
        });

        const result = yield* awaited(pm.resolution.resolve());
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
  );

const shouldDedupeUserSkillEntriesWhenMsa = () =>
  runTest(
    Effect.gen(function* () {
      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", fixture.tempDir);

      try {
        const agentSkillsDir = joinPath(fixture.agentDir, "skills");
        const agentsSkillsDir = joinPath(fixture.tempDir, ".agents", "skills");
        yield* makeDirectory(agentsSkillsDir);

        yield* makeSymlink(agentsSkillsDir, agentSkillsDir);

        const skillPath = joinPath(agentsSkillsDir, "foo", "SKILL.md");
        yield* writeSkill(skillPath, "foo", "foo", "");

        const result = yield* awaited(fixture.packageManager.resolution.resolve());
        const fooSkills = result.skills.filter((r) =>
          packagePaths.pathEndsWith(r.path, "foo/SKILL.md"),
        );

        expect(fooSkills).toHaveLength(1);
      } finally {
        if (previousHome === undefined) {
          vi.stubEnv("HOME", undefined);
        } else {
          vi.stubEnv("HOME", previousHome);
        }
      }
    }),
  );

describe("DefaultPackageManager", () => {
  describe(".agents/skills auto-discovery", () => {
    it(
      "should ignore root markdown files in .agents/skills but discover nested markdown skills",
      shouldIgnoreRootMarkdownFilesInAgents,
    );

    it(
      "should keep ~/.agents/skills user-scoped when cwd is under home in a non-git directory",
      shouldKeepAgentsSkillsUserScopedWhen,
    );

    it(
      "should dedupe user skill entries when ~/.msa/agent/skills is a symlink to ~/.agents/skills",
      shouldDedupeUserSkillEntriesWhenMsa,
    );
  });
});
