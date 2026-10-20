import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { packagePaths } = packageManagerSupport;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeSymlink,
  makeTempDir,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: SettingsManager;

let packageManager: DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldIgnoreRootMarkdownFilesInAgents = () =>
  runTest(
    Effect.gen(function* () {
      const agentsSkillsDir = joinPath(tempDir, ".agents", "skills");
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
      yield* writeTextFile(
        rootSkill,
        "---\nname: root-file\ndescription: Root markdown file\n---\n",
      );
      yield* writeTextFile(
        nestedSkill,
        "---\nname: nested-skill\ndescription: Nested skill\n---\n",
      );
      yield* writeTextFile(
        nestedMarkdownSkill,
        "---\nname: child-skill\ndescription: Nested markdown skill\n---\n",
      );
      yield* writeTextFile(
        deeplyNestedMarkdownSkill,
        "---\nname: deep-skill\ndescription: Deep markdown skill\n---\n",
      );

      const pm = new DefaultPackageManager({
        agentDir,
        cwd: joinPath(tempDir, "work"),
        settingsManager,
      });
      yield* makeDirectory(joinPath(tempDir, "work"));

      const result = yield* awaited(pm.resolve());
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
      vi.stubEnv("HOME", tempDir);

      try {
        const cwd = joinPath(tempDir, "scratch", "nested");
        const localAgentDir = joinPath(tempDir, ".msa", "agent");
        const localSettingsManager = SettingsManager.inMemory();
        yield* makeDirectory(cwd);
        yield* makeDirectory(localAgentDir);

        const homeSkill = joinPath(tempDir, ".agents", "skills", "home-skill", "SKILL.md");
        yield* makeDirectory(joinPath(tempDir, ".agents", "skills", "home-skill"));
        yield* writeTextFile(homeSkill, "---\nname: home-skill\ndescription: home\n---\n");

        const pm = new DefaultPackageManager({
          agentDir: localAgentDir,
          cwd,
          settingsManager: localSettingsManager,
        });

        const result = yield* awaited(pm.resolve());
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
      vi.stubEnv("HOME", tempDir);

      try {
        const agentSkillsDir = joinPath(agentDir, "skills");
        const agentsSkillsDir = joinPath(tempDir, ".agents", "skills");
        yield* makeDirectory(agentsSkillsDir);

        yield* makeSymlink(agentsSkillsDir, agentSkillsDir);

        const skillPath = joinPath(agentsSkillsDir, "foo", "SKILL.md");
        yield* makeDirectory(joinPath(agentsSkillsDir, "foo"));
        yield* writeTextFile(skillPath, "---\nname: foo\ndescription: foo\n---\n");

        const result = yield* awaited(packageManager.resolve());
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

const beforeEachHook = () =>
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

const afterEachHook = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

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
