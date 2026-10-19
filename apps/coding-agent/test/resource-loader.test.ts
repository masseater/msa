import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  awaited,
  runTest,
  currentTimeMillis,
  randomSuffix,
  toJsonText,
  fromJsonText,
  randomSuffixSync,
  readTextFile,
  writeTextFile,
  makeDirectory,
  joinPath,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getThemesDir } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { DefaultResourceLoader, loadProjectContextFiles } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("DefaultResourceLoader", () => {
  let tempDir: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = joinPath(tmpdir(), `rl-test-${currentTimeMillis()}-${randomSuffixSync()}`);
        agentDir = joinPath(tempDir, "agent");
        cwd = joinPath(tempDir, "project");
        yield* makeDirectory(agentDir);
        yield* makeDirectory(cwd);
      }),
    ),
  );

  afterEach(() => runTest(removePath(tempDir)));

  describe("reload", () => {
    it("should initialize with empty results before reload", () => {
      const loader = new DefaultResourceLoader({ cwd, agentDir });

      expect(loader.getExtensions().extensions).toEqual([]);
      expect(loader.getSkills().skills).toEqual([]);
      expect(loader.getPrompts().prompts).toEqual([]);
      expect(loader.getThemes().themes).toEqual([]);
    });

    it("should not treat a project manifest as the owner of a project extension", () =>
      runTest(
        Effect.gen(function* () {
          const extensionsDir = joinPath(cwd, ".msa", "extensions");
          yield* makeDirectory(extensionsDir);
          yield* writeTextFile(
            joinPath(cwd, "package.json"),
            yield* toJsonText({ dependencies: { "@msa/coding-agent": "1.0.0" } }),
          );
          yield* writeTextFile(
            joinPath(extensionsDir, "project-extension.ts"),
            "export default function() {}",
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getExtensions().extensions).toHaveLength(1);
          expect(loader.getExtensions().warnings).toEqual([]);
        }),
      ));

    it("should warn about host dependencies in an extension package manifest", () =>
      runTest(
        Effect.gen(function* () {
          const packageRoot = joinPath(tempDir, "extension-package");
          const extensionsDir = joinPath(packageRoot, "extensions");
          yield* makeDirectory(extensionsDir);
          yield* writeTextFile(
            joinPath(packageRoot, "package.json"),
            yield* toJsonText({ dependencies: { "@msa/coding-agent": "1.0.0" } }),
          );
          yield* writeTextFile(
            joinPath(extensionsDir, "package-extension.ts"),
            "export default function() {}",
          );

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }),
          });
          yield* awaited(loader.reload());

          expect(loader.getExtensions().extensions).toHaveLength(1);
          expect(loader.getExtensions().warnings).toEqual([
            {
              path: joinPath(packageRoot, "package.json"),
              warning:
                'Host-provided extension packages must be declared in peerDependencies with a "*" range, not dependencies: @msa/coding-agent. Installed copies can bypass the extension loader and create duplicate runtime modules.',
            },
          ]);
        }),
      ));

    it("should fail when an extension package manifest cannot be parsed", () =>
      runTest(
        Effect.gen(function* () {
          const packageRoot = joinPath(tempDir, "invalid-extension-package");
          const extensionsDir = joinPath(packageRoot, "extensions");
          yield* makeDirectory(extensionsDir);
          yield* writeTextFile(joinPath(packageRoot, "package.json"), "{");
          yield* writeTextFile(
            joinPath(extensionsDir, "package-extension.ts"),
            "export default function() {}",
          );

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }),
          });

          yield* awaited(expect(loader.reload()).rejects.toThrow(SyntaxError));
        }),
      ));

    it("should discover skills from agentDir", () =>
      runTest(
        Effect.gen(function* () {
          const skillsDir = joinPath(agentDir, "skills");
          yield* makeDirectory(skillsDir);
          yield* writeTextFile(
            joinPath(skillsDir, "test-skill.md"),
            `---
name: test-skill
description: A test skill
---
Skill content here.`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const { skills } = loader.getSkills();
          expect(skills.some((s) => s.name === "test-skill")).toBe(true);
        }),
      ));

    it("should ignore extra markdown files in auto-discovered skill dirs", () =>
      runTest(
        Effect.gen(function* () {
          const skillDir = joinPath(agentDir, "skills", "msa-skills", "browser-tools");
          yield* makeDirectory(skillDir);
          yield* writeTextFile(
            joinPath(skillDir, "SKILL.md"),
            `---
name: browser-tools
description: Browser tools
---
Skill content here.`,
          );
          yield* writeTextFile(joinPath(skillDir, "EFFICIENCY.md"), "No frontmatter here");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const { skills, diagnostics } = loader.getSkills();
          expect(skills.some((s) => s.name === "browser-tools")).toBe(true);
          expect(diagnostics.some((d) => d.path?.endsWith("EFFICIENCY.md"))).toBe(false);
        }),
      ));

    it("should discover prompts from agentDir", () =>
      runTest(
        Effect.gen(function* () {
          const promptsDir = joinPath(agentDir, "prompts");
          yield* makeDirectory(promptsDir);
          yield* writeTextFile(
            joinPath(promptsDir, "test-prompt.md"),
            `---
description: A test prompt
---
Prompt content.`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const { prompts } = loader.getPrompts();
          expect(prompts.some((p) => p.name === "test-prompt")).toBe(true);
        }),
      ));

    it("should report invalid prompt frontmatter while loading valid siblings", () =>
      runTest(
        Effect.gen(function* () {
          const promptsDir = joinPath(agentDir, "prompts");
          const invalidPromptPath = joinPath(promptsDir, "invalid.md");
          yield* makeDirectory(promptsDir);
          yield* writeTextFile(
            invalidPromptPath,
            "---\ndescription: Broken: unquoted colon\n---\nDo something.\n",
          );
          yield* writeTextFile(joinPath(promptsDir, "valid.md"), "Valid prompt content.");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const { prompts, diagnostics } = loader.getPrompts();
          expect(prompts.map((prompt) => prompt.name)).toEqual(["valid"]);
          expect(diagnostics).toEqual([
            expect.objectContaining({
              type: "warning" as const,
              path: invalidPromptPath,
              message: expect.stringContaining("line 1, column 14"),
            }),
          ]);
        }),
      ));

    it("should prefer project resources over user on name collisions", () =>
      runTest(
        Effect.gen(function* () {
          const userPromptsDir = joinPath(agentDir, "prompts");
          const projectPromptsDir = joinPath(cwd, ".msa", "prompts");
          yield* makeDirectory(userPromptsDir);
          yield* makeDirectory(projectPromptsDir);
          const userPromptPath = joinPath(userPromptsDir, "commit.md");
          const projectPromptPath = joinPath(projectPromptsDir, "commit.md");
          yield* writeTextFile(userPromptPath, "User prompt");
          yield* writeTextFile(projectPromptPath, "Project prompt");

          const userSkillDir = joinPath(agentDir, "skills", "collision-skill");
          const projectSkillDir = joinPath(cwd, ".msa", "skills", "collision-skill");
          yield* makeDirectory(userSkillDir);
          yield* makeDirectory(projectSkillDir);
          const userSkillPath = joinPath(userSkillDir, "SKILL.md");
          const projectSkillPath = joinPath(projectSkillDir, "SKILL.md");
          yield* writeTextFile(
            userSkillPath,
            `---
name: collision-skill
description: user
---
User skill`,
          );
          yield* writeTextFile(
            projectSkillPath,
            `---
name: collision-skill
description: project
---
Project skill`,
          );

          const baseTheme = (yield* fromJsonText(
            yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
          )) as {
            name: string;
            vars?: Record<string, string>;
          };
          baseTheme.name = "collision-theme";
          const userThemePath = joinPath(agentDir, "themes", "collision.json");
          const projectThemePath = joinPath(cwd, ".msa", "themes", "collision.json");
          yield* makeDirectory(joinPath(agentDir, "themes"));
          yield* makeDirectory(joinPath(cwd, ".msa", "themes"));
          yield* writeTextFile(userThemePath, yield* toJsonText(baseTheme));
          if (baseTheme.vars !== undefined) {
            baseTheme.vars["accent"] = "#ff00ff";
          }
          yield* writeTextFile(projectThemePath, yield* toJsonText(baseTheme));

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const prompt = loader.getPrompts().prompts.find((p) => p.name === "commit");
          expect(prompt?.filePath).toBe(projectPromptPath);

          const skill = loader.getSkills().skills.find((s) => s.name === "collision-skill");
          expect(skill?.filePath).toBe(projectSkillPath);

          const theme = loader.getThemes().themes.find((t) => t.name === "collision-theme");
          expect(theme?.sourcePath).toBe(projectThemePath);
        }),
      ));

    it("should load symlinked user and project extensions once", () =>
      runTest(
        Effect.gen(function* () {
          const sharedExtDir = joinPath(tempDir, "shared-extensions");
          yield* makeDirectory(sharedExtDir);
          yield* writeTextFile(
            joinPath(sharedExtDir, "shared.ts"),
            `export default function(msa) {
	msa.registerCommand("shared", {
		description: "shared command",
		handler: async () => {},
	});
}`,
          );

          yield* makeDirectory(agentDir);
          yield* makeDirectory(joinPath(cwd, ".msa"));
          symlinkSync(sharedExtDir, joinPath(agentDir, "extensions"), "dir");
          symlinkSync(sharedExtDir, joinPath(cwd, ".msa", "extensions"), "dir");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const extensionsResult = loader.getExtensions();
          expect(extensionsResult.extensions).toHaveLength(1);
          expect(extensionsResult.errors).toEqual([]);

          expect(extensionsResult.extensions[0]?.path).toBe(
            joinPath(cwd, ".msa", "extensions", "shared.ts"),
          );
        }),
      ));

    it("should load user extensions before trust and reuse them after trust resolves", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const userExtDir = joinPath(agentDir, "extensions");
          const projectExtDir = joinPath(cwd, ".msa", "extensions");
          yield* makeDirectory(userExtDir);
          yield* makeDirectory(projectExtDir);
          const loadCountKey = `__piTrustPreloadCount_${currentTimeMillis()}_${yield* randomSuffix}`;
          const globalState = globalThis as typeof globalThis & Record<string, number | undefined>;

          yield* writeTextFile(
            joinPath(userExtDir, "user.ts"),
            `globalThis[${yield* toJsonText(loadCountKey)}] = (globalThis[${yield* toJsonText(loadCountKey)}] ?? 0) + 1;
export default function(msa) {
	msa.on("project_trust", () => ({ trusted: "yes" }));
	msa.registerCommand("user-trust", {
		description: "user trust",
		handler: async () => {},
	});
}`,
          );
          yield* writeTextFile(
            joinPath(projectExtDir, "project.ts"),
            `export default function(msa) {
	msa.registerCommand("project-trusted", {
		description: "project trusted",
		handler: async () => {},
	});
}`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(
            loader.reload({
              resolveProjectTrust: ({ extensionsResult }) =>
                effectRunPromise(
                  Effect.gen(function* () {
                    expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
                      joinPath(userExtDir, "user.ts"),
                    ]);
                    return yield* awaited(true);
                  }),
                ),
            }),
          );

          const extensionsResult = loader.getExtensions();
          expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
            joinPath(cwd, ".msa", "extensions", "project.ts"),
            joinPath(userExtDir, "user.ts"),
          ]);
          expect(globalState[loadCountKey]).toBe(1);
        }),
      ));

    it("should keep both extensions loaded when command names collide", () =>
      runTest(
        Effect.gen(function* () {
          const userExtDir = joinPath(agentDir, "extensions");
          const projectExtDir = joinPath(cwd, ".msa", "extensions");
          yield* makeDirectory(userExtDir);
          yield* makeDirectory(projectExtDir);

          yield* writeTextFile(
            joinPath(projectExtDir, "project.ts"),
            `export default function(msa) {
	msa.registerCommand("deploy", {
		description: "project deploy",
		handler: async () => {},
	});
	msa.registerCommand("project-only", {
		description: "project only",
		handler: async () => {},
	});
}`,
          );

          yield* writeTextFile(
            joinPath(userExtDir, "user.ts"),
            `export default function(msa) {
	msa.registerCommand("deploy", {
		description: "user deploy",
		handler: async () => {},
	});
	msa.registerCommand("user-only", {
		description: "user only",
		handler: async () => {},
	});
}`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const extensionsResult = loader.getExtensions();
          expect(extensionsResult.extensions).toHaveLength(2);
          expect(
            extensionsResult.errors.some((e) => e.error.includes('Command "/deploy" conflicts')),
          ).toBe(false);

          const sessionManager = SessionManager.inMemory();
          const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
          const modelRegistry = yield* awaited(createModelRegistry(authStorage));
          const runner = new ExtensionRunner(
            extensionsResult.extensions,
            extensionsResult.runtime,
            cwd,
            sessionManager,
            modelRegistry,
          );

          expect(runner.getCommand("deploy:1")?.description).toBe("project deploy");
          expect(runner.getCommand("deploy:2")?.description).toBe("user deploy");
          expect(runner.getCommand("project-only")?.description).toBe("project only");
          expect(runner.getCommand("user-only")?.description).toBe("user only");

          const commands = runner.getRegisteredCommands();
          expect(commands.map((command) => command.invocationName)).toEqual([
            "deploy:1",
            "project-only",
            "deploy:2",
            "user-only",
          ]);
        }),
      ));

    it("should honor overrides for auto-discovered resources", () =>
      runTest(
        Effect.gen(function* () {
          const settingsManager = SettingsManager.inMemory();
          settingsManager.setExtensionPaths(["-extensions/disabled.ts"]);
          settingsManager.setSkillPaths(["-skills/skip-skill"]);
          settingsManager.setPromptTemplatePaths(["-prompts/skip.md"]);
          settingsManager.setThemePaths(["-themes/skip.json"]);

          const extensionsDir = joinPath(agentDir, "extensions");
          yield* makeDirectory(extensionsDir);
          yield* writeTextFile(
            joinPath(extensionsDir, "disabled.ts"),
            "export default function() {}",
          );

          const skillDir = joinPath(agentDir, "skills", "skip-skill");
          yield* makeDirectory(skillDir);
          yield* writeTextFile(
            joinPath(skillDir, "SKILL.md"),
            `---
name: skip-skill
description: Skip me
---
Content`,
          );

          const promptsDir = joinPath(agentDir, "prompts");
          yield* makeDirectory(promptsDir);
          yield* writeTextFile(joinPath(promptsDir, "skip.md"), "Skip prompt");

          const themesDir = joinPath(agentDir, "themes");
          yield* makeDirectory(themesDir);
          yield* writeTextFile(joinPath(themesDir, "skip.json"), "{}");

          const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
          yield* awaited(loader.reload());

          const { extensions } = loader.getExtensions();
          const { skills } = loader.getSkills();
          const { prompts } = loader.getPrompts();
          const { themes } = loader.getThemes();

          expect(extensions.some((e) => e.path.endsWith("disabled.ts"))).toBe(false);
          expect(skills.some((s) => s.name === "skip-skill")).toBe(false);
          expect(prompts.some((p) => p.name === "skip")).toBe(false);
          expect(themes.some((t) => t.sourcePath?.endsWith("skip.json"))).toBe(false);
        }),
      ));

    it("should discover AGENTS.md context files", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "# Project Guidelines\n\nBe helpful.");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const { agentsFiles } = loader.getAgentsFiles();
          expect(agentsFiles.some((f) => f.path.includes("AGENTS.md"))).toBe(true);
        }),
      ));

    it("should prefer AGENTS.override.md within each directory while preserving ancestor layering", () =>
      runTest(
        Effect.gen(function* () {
          const nestedCwd = joinPath(cwd, "service");
          yield* makeDirectory(nestedCwd);
          yield* writeTextFile(joinPath(agentDir, "AGENTS.md"), "global instructions");
          yield* writeTextFile(joinPath(agentDir, "AGENTS.override.md"), "global override");
          yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "project instructions");
          yield* writeTextFile(joinPath(nestedCwd, "AGENTS.md"), "service instructions");
          yield* writeTextFile(joinPath(nestedCwd, "AGENTS.override.md"), "service override");

          const loader = new DefaultResourceLoader({ cwd: nestedCwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getAgentsFiles().agentsFiles).toEqual([
            { path: joinPath(agentDir, "AGENTS.override.md"), content: "global override" },
            { path: joinPath(cwd, "AGENTS.md"), content: "project instructions" },
            { path: joinPath(nestedCwd, "AGENTS.override.md"), content: "service override" },
          ]);
        }),
      ));

    it("should ignore context file candidates that are directories", () =>
      runTest(
        Effect.gen(function* () {
          yield* makeDirectory(joinPath(cwd, "AGENTS.override.md"));
          yield* makeDirectory(joinPath(cwd, "AGENTS.md"));
          yield* writeTextFile(joinPath(cwd, "CLAUDE.md"), "Fallback instructions");
          const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getAgentsFiles().agentsFiles).toContainEqual({
            path: joinPath(cwd, "CLAUDE.md"),
            content: "Fallback instructions",
          });
          expect(consoleError).not.toHaveBeenCalledWith(
            expect.stringContaining(joinPath(cwd, "AGENTS.md")),
          );
          expect(consoleError).not.toHaveBeenCalledWith(
            expect.stringContaining(joinPath(cwd, "AGENTS.override.md")),
          );
          consoleError.mockRestore();
        }),
      ));

    it("should skip context file discovery when noContextFiles is true", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeTextFile(
            joinPath(cwd, "AGENTS.override.md"),
            "# Override Guidelines\n\nBe helpful.",
          );
          yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "# Project Guidelines\n\nBe helpful.");
          yield* writeTextFile(joinPath(cwd, "CLAUDE.md"), "# Claude Guidelines\n\nBe helpful.");

          const loader = new DefaultResourceLoader({ cwd, agentDir, noContextFiles: true });
          yield* awaited(loader.reload());

          const { agentsFiles } = loader.getAgentsFiles();
          expect(agentsFiles).toEqual([]);
        }),
      ));

    it("should discover SYSTEM.md from cwd/.msa", () =>
      runTest(
        Effect.gen(function* () {
          const msaDir = joinPath(cwd, ".msa");
          yield* makeDirectory(msaDir);
          yield* writeTextFile(joinPath(msaDir, "SYSTEM.md"), "You are a helpful assistant.");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getSystemPrompt()).toBe("You are a helpful assistant.");
        }),
      ));

    it("should skip project resources that require trust when project is not trusted", () =>
      runTest(
        Effect.gen(function* () {
          const msaDir = joinPath(cwd, ".msa");
          const extensionsDir = joinPath(msaDir, "extensions");
          const skillDir = joinPath(msaDir, "skills", "project-skill");
          const promptsDir = joinPath(msaDir, "prompts");
          const themesDir = joinPath(msaDir, "themes");
          yield* makeDirectory(extensionsDir);
          yield* makeDirectory(skillDir);
          yield* makeDirectory(promptsDir);
          yield* makeDirectory(themesDir);
          yield* writeTextFile(joinPath(msaDir, "SYSTEM.md"), "Project system prompt.");
          yield* writeTextFile(joinPath(agentDir, "SYSTEM.md"), "Global system prompt.");
          yield* writeTextFile(joinPath(agentDir, "AGENTS.md"), "Global instructions");
          yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "Project instructions");
          yield* writeTextFile(
            joinPath(extensionsDir, "project.ts"),
            `throw new Error("should not load");`,
          );
          yield* writeTextFile(
            joinPath(skillDir, "SKILL.md"),
            `---
name: project-skill
description: Project skill
---
Project skill content`,
          );
          yield* writeTextFile(joinPath(promptsDir, "project.md"), "Project prompt");
          const themeData = (yield* fromJsonText(
            yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
          )) as {
            name: string;
          };
          themeData.name = "project-theme";
          yield* writeTextFile(joinPath(themesDir, "project.json"), yield* toJsonText(themeData));
          const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });

          const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
          yield* awaited(loader.reload());

          expect(loader.getSystemPrompt()).toBe("Global system prompt.");
          expect(
            loader
              .getAgentsFiles()
              .agentsFiles.some((file) => file.path === joinPath(agentDir, "AGENTS.md")),
          ).toBe(true);
          expect(
            loader
              .getAgentsFiles()
              .agentsFiles.some((file) => file.path === joinPath(cwd, "AGENTS.md")),
          ).toBe(true);
          expect(loader.getExtensions().extensions).toHaveLength(0);
          expect(loader.getExtensions().errors).toEqual([]);
          expect(loader.getSkills().skills.some((skill) => skill.name === "project-skill")).toBe(
            false,
          );
          expect(loader.getPrompts().prompts.some((prompt) => prompt.name === "project")).toBe(
            false,
          );
          expect(loader.getThemes().themes.some((theme) => theme.name === "project-theme")).toBe(
            false,
          );
        }),
      ));

    it("should discover APPEND_SYSTEM.md", () =>
      runTest(
        Effect.gen(function* () {
          const msaDir = joinPath(cwd, ".msa");
          yield* makeDirectory(msaDir);
          yield* writeTextFile(joinPath(msaDir, "APPEND_SYSTEM.md"), "Additional instructions.");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getAppendSystemPrompt()).toContain("Additional instructions.");
        }),
      ));
  });

  describe("system prompt sources", () => {
    it("exposes discovered project SYSTEM.md as the system prompt source", () =>
      runTest(
        Effect.gen(function* () {
          const msaDir = joinPath(cwd, ".msa");
          const systemPromptPath = joinPath(msaDir, "SYSTEM.md");
          yield* makeDirectory(msaDir);
          yield* writeTextFile(systemPromptPath, "Project system prompt.");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getSystemPrompt()).toBe("Project system prompt.");
          expect(loader.getSystemPromptSource()).toEqual({ path: systemPromptPath });
        }),
      ));

    it("exposes discovered global SYSTEM.md as the system prompt source", () =>
      runTest(
        Effect.gen(function* () {
          const systemPromptPath = joinPath(agentDir, "SYSTEM.md");
          yield* writeTextFile(systemPromptPath, "Global system prompt.");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getSystemPrompt()).toBe("Global system prompt.");
          expect(loader.getSystemPromptSource()).toEqual({ path: systemPromptPath });
        }),
      ));

    it("does not expose literal system prompt text as a source", () =>
      runTest(
        Effect.gen(function* () {
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            systemPrompt: "Literal system prompt.",
          });
          yield* awaited(loader.reload());

          expect(loader.getSystemPrompt()).toBe("Literal system prompt.");
          expect(loader.getSystemPromptSource()).toBeUndefined();
        }),
      ));

    it("exposes file-backed system prompt options as a source", () =>
      runTest(
        Effect.gen(function* () {
          const systemPromptPath = joinPath(tempDir, "custom-system.md");
          yield* writeTextFile(systemPromptPath, "Custom system prompt.");

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            systemPrompt: systemPromptPath,
          });
          yield* awaited(loader.reload());

          expect(loader.getSystemPrompt()).toBe("Custom system prompt.");
          expect(loader.getSystemPromptSource()).toEqual({ path: systemPromptPath });
        }),
      ));

    it("exposes discovered APPEND_SYSTEM.md as an append system prompt source", () =>
      runTest(
        Effect.gen(function* () {
          const msaDir = joinPath(cwd, ".msa");
          const appendSystemPromptPath = joinPath(msaDir, "APPEND_SYSTEM.md");
          yield* makeDirectory(msaDir);
          yield* writeTextFile(appendSystemPromptPath, "Project append prompt.");

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          expect(loader.getAppendSystemPrompt()).toEqual(["Project append prompt."]);
          expect(loader.getAppendSystemPromptSources()).toEqual([{ path: appendSystemPromptPath }]);
        }),
      ));

    it("does not expose literal append system prompt text as a source", () =>
      runTest(
        Effect.gen(function* () {
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            appendSystemPrompt: ["Literal append prompt."],
          });
          yield* awaited(loader.reload());

          expect(loader.getAppendSystemPrompt()).toEqual(["Literal append prompt."]);
          expect(loader.getAppendSystemPromptSources()).toEqual([]);
        }),
      ));

    it("only exposes file-backed append system prompt options as sources", () =>
      runTest(
        Effect.gen(function* () {
          const appendSystemPromptPath = joinPath(tempDir, "custom-append.md");
          yield* writeTextFile(appendSystemPromptPath, "Custom append prompt.");

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            appendSystemPrompt: [appendSystemPromptPath, "Literal append prompt."],
          });
          yield* awaited(loader.reload());

          expect(loader.getAppendSystemPrompt()).toEqual([
            "Custom append prompt.",
            "Literal append prompt.",
          ]);
          expect(loader.getAppendSystemPromptSources()).toEqual([{ path: appendSystemPromptPath }]);
        }),
      ));
  });

  describe("extendResources", () => {
    it("should load skills and prompts with extension metadata", () =>
      runTest(
        Effect.gen(function* () {
          const extraSkillDir = joinPath(tempDir, "extra-skills", "extra-skill");
          yield* makeDirectory(extraSkillDir);
          const skillPath = joinPath(extraSkillDir, "SKILL.md");
          yield* writeTextFile(
            skillPath,
            `---
name: extra-skill
description: Extra skill
---
Extra content`,
          );

          const extraPromptDir = joinPath(tempDir, "extra-prompts");
          yield* makeDirectory(extraPromptDir);
          const promptPath = joinPath(extraPromptDir, "extra.md");
          yield* writeTextFile(
            promptPath,
            `---
description: Extra prompt
---
Extra prompt content`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          loader.extendResources({
            skillPaths: [
              {
                path: extraSkillDir,
                metadata: {
                  source: "extension:extra",
                  scope: "temporary",
                  origin: "top-level",
                  baseDir: extraSkillDir,
                },
              },
            ],
            promptPaths: [
              {
                path: promptPath,
                metadata: {
                  source: "extension:extra",
                  scope: "temporary",
                  origin: "top-level",
                  baseDir: extraPromptDir,
                },
              },
            ],
          });

          const { skills } = loader.getSkills();
          const loadedSkill = skills.find((skill) => skill.name === "extra-skill");
          expect(loadedSkill).toBeDefined();
          expect(loadedSkill?.sourceInfo?.source).toBe("extension:extra");
          expect(loadedSkill?.sourceInfo?.path).toBe(skillPath);

          const { prompts } = loader.getPrompts();
          const loadedPrompt = prompts.find((prompt) => prompt.name === "extra");
          expect(loadedPrompt).toBeDefined();
          expect(loadedPrompt?.sourceInfo?.source).toBe("extension:extra");
          expect(loadedPrompt?.sourceInfo?.path).toBe(promptPath);
        }),
      ));

    it("should load extension resources returned as file URLs", () =>
      runTest(
        Effect.gen(function* () {
          const extraSkillDir = joinPath(tempDir, "extra skills", "file-url-skill");
          yield* makeDirectory(extraSkillDir);
          const skillPath = joinPath(extraSkillDir, "SKILL.md");
          yield* writeTextFile(
            skillPath,
            `---
name: file-url-skill
description: File URL skill
---
Extra content`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          loader.extendResources({
            skillPaths: [
              {
                path: pathToFileURL(extraSkillDir).href,
                metadata: {
                  source: "extension:file-url",
                  scope: "temporary",
                  origin: "top-level",
                  baseDir: extraSkillDir,
                },
              },
            ],
          });

          const { skills, diagnostics } = loader.getSkills();
          expect(diagnostics).toEqual([]);
          const loadedSkill = skills.find((skill) => skill.name === "file-url-skill");
          expect(loadedSkill).toBeDefined();
          expect(loadedSkill?.filePath).toBe(skillPath);
          expect(loadedSkill?.sourceInfo?.source).toBe("extension:file-url");
        }),
      ));

    it("should keep package metadata for skills, prompts, and themes", () =>
      runTest(
        Effect.gen(function* () {
          const packageRoot = joinPath(agentDir, "npm", "node_modules", "metadata-pkg");
          const packageSkillDir = joinPath(packageRoot, "skills", "package-skill");
          const packagePromptsDir = joinPath(packageRoot, "prompts");
          const packageThemesDir = joinPath(packageRoot, "themes");
          yield* makeDirectory(packageSkillDir);
          yield* makeDirectory(packagePromptsDir);
          yield* makeDirectory(packageThemesDir);
          yield* writeTextFile(
            joinPath(packageRoot, "package.json"),
            yield* toJsonText({ name: "metadata-pkg", version: "1.0.0" }),
          );
          yield* writeTextFile(
            joinPath(packageSkillDir, "SKILL.md"),
            `---
name: package-skill
description: Package skill
---
Package skill content`,
          );
          yield* writeTextFile(
            joinPath(packagePromptsDir, "package-prompt.md"),
            `---
description: Package prompt
---
Package prompt content`,
          );
          const baseTheme = (yield* fromJsonText(
            yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
          )) as {
            name: string;
          };
          yield* writeTextFile(
            joinPath(packageThemesDir, "package-theme.json"),
            yield* toJsonText({ ...baseTheme, name: "package-theme" }),
          );

          const extensionResourceDir = joinPath(tempDir, "extension-resources");
          const extensionSkillDir = joinPath(extensionResourceDir, "extension-skill");
          const extensionPromptsDir = joinPath(extensionResourceDir, "prompts");
          const extensionThemesDir = joinPath(extensionResourceDir, "themes");
          yield* makeDirectory(extensionSkillDir);
          yield* makeDirectory(extensionPromptsDir);
          yield* makeDirectory(extensionThemesDir);
          yield* writeTextFile(
            joinPath(extensionSkillDir, "SKILL.md"),
            `---
name: extension-skill
description: Extension skill
---
Extension skill content`,
          );
          yield* writeTextFile(
            joinPath(extensionPromptsDir, "extension-prompt.md"),
            `---
description: Extension prompt
---
Extension prompt content`,
          );
          yield* writeTextFile(
            joinPath(extensionThemesDir, "extension.json"),
            yield* toJsonText({ ...baseTheme, name: "extension-theme" }),
          );

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            settingsManager: SettingsManager.inMemory({ packages: ["npm:metadata-pkg"] }),
          });
          yield* awaited(loader.reload());

          const extensionMetadata = {
            source: "extension:discovery",
            scope: "temporary",
            origin: "top-level",
          } as const;
          loader.extendResources({
            skillPaths: [{ path: extensionSkillDir, metadata: extensionMetadata }],
            promptPaths: [{ path: extensionPromptsDir, metadata: extensionMetadata }],
            themePaths: [{ path: extensionThemesDir, metadata: extensionMetadata }],
          });

          const packageSourceInfo = {
            source: "npm:metadata-pkg",
            scope: "user",
            origin: "package",
          };
          expect(
            loader.getSkills().skills.find((skill) => skill.name === "package-skill")?.sourceInfo,
          ).toMatchObject(packageSourceInfo);
          expect(
            loader.getPrompts().prompts.find((prompt) => prompt.name === "package-prompt")
              ?.sourceInfo,
          ).toMatchObject(packageSourceInfo);
          expect(
            loader.getThemes().themes.find((theme) => theme.name === "package-theme")?.sourceInfo,
          ).toMatchObject(packageSourceInfo);

          expect(
            loader.getSkills().skills.find((skill) => skill.name === "extension-skill")?.sourceInfo,
          ).toMatchObject(extensionMetadata);
          expect(
            loader.getPrompts().prompts.find((prompt) => prompt.name === "extension-prompt")
              ?.sourceInfo,
          ).toMatchObject(extensionMetadata);
          expect(
            loader.getThemes().themes.find((theme) => theme.name === "extension-theme")?.sourceInfo,
          ).toMatchObject(extensionMetadata);
        }),
      ));
  });

  describe("noSkills option", () => {
    it("should skip skill discovery when noSkills is true", () =>
      runTest(
        Effect.gen(function* () {
          const skillsDir = joinPath(agentDir, "skills");
          yield* makeDirectory(skillsDir);
          yield* writeTextFile(
            joinPath(skillsDir, "test-skill.md"),
            `---
name: test-skill
description: A test skill
---
Content`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir, noSkills: true });
          yield* awaited(loader.reload());

          const { skills } = loader.getSkills();
          expect(skills).toEqual([]);
        }),
      ));

    it("should still load additional skill paths when noSkills is true", () =>
      runTest(
        Effect.gen(function* () {
          const customSkillDir = joinPath(tempDir, "custom-skills");
          yield* makeDirectory(customSkillDir);
          yield* writeTextFile(
            joinPath(customSkillDir, "custom.md"),
            `---
name: custom
description: Custom skill
---
Content`,
          );

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            noSkills: true,
            additionalSkillPaths: [customSkillDir],
          });
          yield* awaited(loader.reload());

          const { skills } = loader.getSkills();
          expect(skills.some((s) => s.name === "custom")).toBe(true);
        }),
      ));
  });

  describe("override functions", () => {
    it("should apply skillsOverride", () =>
      runTest(
        Effect.gen(function* () {
          const injectedSkill: Skill = {
            name: "injected",
            description: "Injected skill",
            filePath: "/fake/path",
            baseDir: "/fake",
            sourceInfo: createSyntheticSourceInfo("/fake/path", { source: "custom" }),
            disableModelInvocation: false,
          };
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            skillsOverride: () => ({
              skills: [injectedSkill],
              diagnostics: [],
            }),
          });
          yield* awaited(loader.reload());

          const { skills } = loader.getSkills();
          expect(skills).toHaveLength(1);
          expect(skills[0]?.name).toBe("injected");
        }),
      ));

    it("should apply systemPromptOverride", () =>
      runTest(
        Effect.gen(function* () {
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            systemPromptOverride: () => "Custom system prompt",
          });
          yield* awaited(loader.reload());

          expect(loader.getSystemPrompt()).toBe("Custom system prompt");
        }),
      ));
  });

  describe("extension conflict detection", () => {
    it("should detect tool conflicts between extensions", () =>
      runTest(
        Effect.gen(function* () {
          const ext1Dir = joinPath(agentDir, "extensions", "ext1");
          const ext2Dir = joinPath(agentDir, "extensions", "ext2");
          yield* makeDirectory(ext1Dir);
          yield* makeDirectory(ext2Dir);

          yield* writeTextFile(
            joinPath(ext1Dir, "index.ts"),
            `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
    name: "duplicate-tool",
    description: "First",
    parameters: Type.Object({}),
    execute: async () => ({ result: "1" }),
  });
}`,
          );

          yield* writeTextFile(
            joinPath(ext2Dir, "index.ts"),
            `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
    name: "duplicate-tool",
    description: "Second",
    parameters: Type.Object({}),
    execute: async () => ({ result: "2" }),
  });
}`,
          );

          const loader = new DefaultResourceLoader({ cwd, agentDir });
          yield* awaited(loader.reload());

          const { errors } = loader.getExtensions();
          expect(
            errors.some((e) => e.error.includes("duplicate-tool") && e.error.includes("conflicts")),
          ).toBe(true);
        }),
      ));

    it("should prefer explicit CLI extensions over discovered extensions when commands and tools conflict", () =>
      runTest(
        Effect.gen(function* () {
          const globalExtDir = joinPath(agentDir, "extensions");
          yield* makeDirectory(globalExtDir);
          const explicitExtPath = joinPath(tempDir, "explicit-extension.ts");

          yield* writeTextFile(
            joinPath(globalExtDir, "global.ts"),
            `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
    name: "duplicate-tool",
    description: "global tool",
    parameters: Type.Object({}),
    execute: async () => ({ result: "global" }),
  });
  msa.registerCommand("deploy", {
    description: "global command",
    handler: async () => {},
  });
}`,
          );

          yield* writeTextFile(
            explicitExtPath,
            `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
    name: "duplicate-tool",
    description: "explicit tool",
    parameters: Type.Object({}),
    execute: async () => ({ result: "explicit" }),
  });
  msa.registerCommand("deploy", {
    description: "explicit command",
    handler: async () => {},
  });
}`,
          );

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            additionalExtensionPaths: [explicitExtPath],
          });
          yield* awaited(loader.reload());

          const extensionsResult = loader.getExtensions();
          expect(extensionsResult.extensions[0]?.path).toBe(explicitExtPath);

          const sessionManager = SessionManager.inMemory();
          const authStorage = AuthStorage.create(joinPath(tempDir, "auth-explicit.json"));
          const modelRegistry = yield* awaited(createModelRegistry(authStorage));
          const runner = new ExtensionRunner(
            extensionsResult.extensions,
            extensionsResult.runtime,
            cwd,
            sessionManager,
            modelRegistry,
          );

          expect(runner.getCommand("deploy:1")?.description).toBe("explicit command");
          expect(runner.getCommand("deploy:2")?.description).toBe("global command");
          expect(runner.getToolDefinition("duplicate-tool")?.description).toBe("explicit tool");
        }),
      ));

    it("should leave out replaceable extensions whose names another extension registers", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const globalExtDir = joinPath(agentDir, "extensions");
          yield* makeDirectory(globalExtDir);
          yield* writeTextFile(
            joinPath(globalExtDir, "other-mcp.ts"),
            `
import type { ExtensionAPI } from "@msa/coding-agent";
export default function(msa: ExtensionAPI) {
  msa.registerCommand("mcp", { description: "other mcp", handler: async () => {} });
}`,
          );

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            extensionFactories: [
              {
                name: "mcp",
                replaceable: true,
                factory: (msa) =>
                  msa.registerCommand("mcp", {
                    description: "built-in mcp",
                    handler: () => effectRunPromise(Effect.sync(() => {})),
                  }),
              },
              {
                name: "llama",
                replaceable: true,
                factory: (msa) =>
                  msa.registerCommand("llama", {
                    description: "built-in llama",
                    handler: () => effectRunPromise(Effect.sync(() => {})),
                  }),
              },
            ],
          });
          yield* awaited(loader.reload());

          const extensionsResult = loader.getExtensions();
          expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
            joinPath(globalExtDir, "other-mcp.ts"),
            "<inline:llama>",
          ]);
          expect(extensionsResult.errors).toEqual([]);

          const runner = new ExtensionRunner(
            extensionsResult.extensions,
            extensionsResult.runtime,
            cwd,
            SessionManager.inMemory(),
            yield* awaited(
              createModelRegistry(AuthStorage.create(joinPath(tempDir, "auth-replaceable.json"))),
            ),
          );
          expect(runner.getCommand("mcp")?.description).toBe("other mcp");
          expect(runner.getCommand("llama")?.description).toBe("built-in llama");
        }),
      ));

    it("should skip built-in extensions disabled in settings", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeTextFile(
            joinPath(agentDir, "settings.json"),
            yield* toJsonText({ extensions: ["-builtin:mcp"] }),
          );
          const loaded: string[] = [];
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            extensionFactories: [
              { name: "mcp", builtin: true, factory: () => void loaded.push("mcp") },
              { name: "llama", builtin: true, factory: () => void loaded.push("llama") },
            ],
          });
          yield* awaited(loader.reload());

          expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
            "builtin:llama",
          ]);
          expect(loader.getExtensions().extensions[0]?.sourceInfo).toMatchObject({
            path: "builtin:llama",
            source: "builtin",
          });
          expect(loader.getExtensions().extensions[0]?.hidden).toBe(true);
          expect(loaded).toEqual(["llama"]);
        }),
      ));

    it("should skip disabledBuiltinExtensions even when settings or -e enable them", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* makeDirectory(joinPath(cwd, ".msa"));
          yield* writeTextFile(
            joinPath(cwd, ".msa", "settings.json"),
            yield* toJsonText({ extensions: ["+builtin:mcp"] }),
          );
          const loaded: string[] = [];
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            disabledBuiltinExtensions: ["mcp"],
            additionalExtensionPaths: ["builtin:mcp"],
            extensionFactories: [
              { name: "mcp", builtin: true, factory: () => void loaded.push("mcp") },
              { name: "llama", builtin: true, factory: () => void loaded.push("llama") },
            ],
          });
          yield* awaited(
            loader.reload({ resolveProjectTrust: () => effectRunPromise(awaited(true)) }),
          );

          expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
            "builtin:llama",
          ]);
          expect(loader.getExtensions().errors).toEqual([]);
          expect(loaded).toEqual(["llama"]);
        }),
      ));

    it("should load built-in extensions after file extensions with and without trust resolution", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const userExtDir = joinPath(agentDir, "extensions");
          yield* makeDirectory(userExtDir);
          yield* writeTextFile(joinPath(userExtDir, "user.ts"), "export default function() {}");
          yield* makeDirectory(joinPath(cwd, ".msa"));

          yield* writeTextFile(
            joinPath(cwd, ".msa", "settings.json"),
            yield* toJsonText({ extensions: ["+builtin:mcp"] }),
          );
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            extensionFactories: [{ name: "mcp", builtin: true, factory: () => {} }],
          });
          const expected = [joinPath(userExtDir, "user.ts"), "builtin:mcp"];

          yield* awaited(
            loader.reload({ resolveProjectTrust: () => effectRunPromise(awaited(true)) }),
          );
          expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual(
            expected,
          );
          yield* awaited(loader.reload());
          expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual(
            expected,
          );
        }),
      ));

    it("should disable built-in extensions with noExtensions unless loaded with -e builtin:<name>", () =>
      runTest(
        Effect.gen(function* () {
          const loaded: string[] = [];
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            noExtensions: true,
            additionalExtensionPaths: ["builtin:mcp", "builtin:missing"],
            extensionFactories: [
              { name: "mcp", builtin: true, factory: () => void loaded.push("mcp") },
              { name: "llama", builtin: true, factory: () => void loaded.push("llama") },
            ],
          });
          yield* awaited(loader.reload());

          expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
            "builtin:mcp",
          ]);
          expect(loader.getExtensions().errors).toEqual([
            { path: "builtin:missing", error: "Unknown built-in extension: builtin:missing" },
          ]);
          expect(loaded).toEqual(["mcp"]);
        }),
      ));

    it("should apply project built-in extension overrides after trust resolves", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* writeTextFile(
            joinPath(agentDir, "settings.json"),
            yield* toJsonText({ extensions: ["-builtin:mcp"] }),
          );
          yield* makeDirectory(joinPath(cwd, ".msa"));
          yield* writeTextFile(
            joinPath(cwd, ".msa", "settings.json"),
            yield* toJsonText({ extensions: ["+builtin:mcp", "-builtin:llama"] }),
          );
          const loaded: string[] = [];
          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            extensionFactories: [
              { name: "mcp", builtin: true, factory: () => void loaded.push("mcp") },
              { name: "plain", factory: () => void loaded.push("plain") },
              { name: "llama", builtin: true, factory: () => void loaded.push("llama") },
            ],
          });
          yield* awaited(
            loader.reload({
              resolveProjectTrust: ({ extensionsResult }) =>
                effectRunPromise(
                  Effect.gen(function* () {
                    expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
                      "<inline:plain>",
                    ]);
                    return yield* awaited(true);
                  }),
                ),
            }),
          );

          expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
            "builtin:mcp",
            "<inline:plain>",
          ]);
          expect(loaded).toEqual(["plain", "mcp"]);
        }),
      ));
  });

  describe("loadProjectContextFiles - nested worktree dedup", () => {
    const linkWorktree = (mainDir: string, worktreeDir: string, name: string) => {
      const gitDir = joinPath(mainDir, ".git", "worktrees", name);
      mkdirSync(gitDir, { recursive: true });

      writeFileSync(joinPath(mainDir, ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(joinPath(gitDir, "HEAD"), "ref: refs/heads/feat\n");

      writeFileSync(joinPath(gitDir, "commondir"), "../..");
      writeFileSync(joinPath(worktreeDir, ".git"), `gitdir: ${gitDir}\n`);
    };

    const setupNestedWorktree = () => {
      const outer = joinPath(tempDir, "outer");
      const main = joinPath(outer, "main");
      const worktree = joinPath(main, "worktrees", "feat");
      const worktreeSrc = joinPath(worktree, "src");
      mkdirSync(worktreeSrc, { recursive: true });
      linkWorktree(main, worktree, "feat");
      return { outer, main, worktree, worktreeSrc };
    };

    it("should skip the main repo's duplicate when the worktree root has its own context", () => {
      const { main, worktree, worktreeSrc } = setupNestedWorktree();
      writeFileSync(joinPath(main, "AGENTS.md"), "main repo instructions");
      writeFileSync(joinPath(worktree, "AGENTS.md"), "worktree instructions");

      const files = loadProjectContextFiles({ cwd: worktreeSrc, agentDir });

      expect(files.map((f) => f.content)).toEqual(["worktree instructions"]);
    });

    it("should load the worktree's context once when it symlinks to the main repo's file", () => {
      const { main, worktree, worktreeSrc } = setupNestedWorktree();
      writeFileSync(joinPath(main, "AGENTS.md"), "main repo instructions");
      symlinkSync(joinPath(main, "AGENTS.md"), joinPath(worktree, "AGENTS.md"));

      const files = loadProjectContextFiles({ cwd: worktreeSrc, agentDir });

      expect(files.map((f) => f.path)).toEqual([joinPath(worktree, "AGENTS.md")]);
    });

    it("should skip the main repo's duplicate when the main repo's file is a symlink", () => {
      const { outer, main, worktree, worktreeSrc } = setupNestedWorktree();
      const shared = joinPath(outer, "shared-agents.md");
      writeFileSync(shared, "shared instructions");
      symlinkSync(shared, joinPath(main, "AGENTS.md"));
      symlinkSync(shared, joinPath(worktree, "AGENTS.md"));

      const files = loadProjectContextFiles({ cwd: worktreeSrc, agentDir });

      expect(files.map((f) => f.path)).toEqual([joinPath(worktree, "AGENTS.md")]);
    });

    it("should still inherit the main repo's context when the worktree root has none", () => {
      const { main, worktreeSrc } = setupNestedWorktree();
      writeFileSync(joinPath(main, "AGENTS.md"), "main repo instructions");

      const files = loadProjectContextFiles({ cwd: worktreeSrc, agentDir });

      expect(files.map((f) => f.content)).toEqual(["main repo instructions"]);
    });

    it("should only skip the same filename, not a differently named context file", () => {
      const { main, worktree, worktreeSrc } = setupNestedWorktree();
      writeFileSync(joinPath(main, "CLAUDE.md"), "main repo instructions");
      writeFileSync(joinPath(worktree, "AGENTS.md"), "worktree instructions");

      const files = loadProjectContextFiles({ cwd: worktreeSrc, agentDir });

      expect(files.map((f) => f.content)).toEqual([
        "main repo instructions",
        "worktree instructions",
      ]);
    });

    it("should NOT skip the container's context in a bare layout (proj/.bare + proj/main)", () => {
      const proj = joinPath(tempDir, "proj");
      const bare = joinPath(proj, ".bare");
      const worktree = joinPath(proj, "main");
      const worktreeGitDir = joinPath(bare, "worktrees", "main");
      mkdirSync(worktreeGitDir, { recursive: true });
      mkdirSync(worktree, { recursive: true });
      writeFileSync(joinPath(bare, "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(joinPath(worktreeGitDir, "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(joinPath(worktreeGitDir, "commondir"), "../..");
      writeFileSync(joinPath(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`);
      writeFileSync(joinPath(proj, "AGENTS.md"), "container instructions");
      writeFileSync(joinPath(worktree, "AGENTS.md"), "worktree instructions");

      const files = loadProjectContextFiles({ cwd: worktree, agentDir });

      expect(files.map((f) => f.content)).toEqual([
        "container instructions",
        "worktree instructions",
      ]);
    });

    it("should keep loading ancestors above the main repo", () => {
      const { outer, main, worktree, worktreeSrc } = setupNestedWorktree();
      writeFileSync(joinPath(outer, "AGENTS.md"), "outer instructions");
      writeFileSync(joinPath(main, "AGENTS.md"), "main repo instructions");
      writeFileSync(joinPath(worktree, "AGENTS.md"), "worktree instructions");

      const files = loadProjectContextFiles({ cwd: worktreeSrc, agentDir });

      expect(files.map((f) => f.content)).toEqual(["outer instructions", "worktree instructions"]);
    });

    it("should NOT skip anything for a sibling worktree (main repo is not an ancestor)", () => {
      const outer = joinPath(tempDir, "outer");
      const main = joinPath(outer, "main");
      const sib = joinPath(outer, "sib-feat");
      const sibSrc = joinPath(sib, "src");
      mkdirSync(sibSrc, { recursive: true });
      mkdirSync(main, { recursive: true });
      writeFileSync(joinPath(outer, "AGENTS.md"), "outer instructions");
      writeFileSync(joinPath(sib, "AGENTS.md"), "sibling worktree instructions");
      linkWorktree(main, sib, "sib");

      const files = loadProjectContextFiles({ cwd: sibSrc, agentDir });

      expect(files.map((f) => f.content)).toEqual([
        "outer instructions",
        "sibling worktree instructions",
      ]);
    });

    it("should NOT skip the superproject's context from inside a submodule", () => {
      const sup = joinPath(tempDir, "super");
      const sub = joinPath(sup, "vendor", "lib");
      const subSrc = joinPath(sub, "src");
      mkdirSync(subSrc, { recursive: true });
      writeFileSync(joinPath(sup, "AGENTS.md"), "superproject instructions");
      writeFileSync(joinPath(sub, "AGENTS.md"), "submodule instructions");
      const subGitDir = joinPath(sup, ".git", "modules", "vendor", "lib");
      mkdirSync(subGitDir, { recursive: true });
      writeFileSync(joinPath(subGitDir, "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(joinPath(sub, ".git"), `gitdir: ${subGitDir}\n`);

      const files = loadProjectContextFiles({ cwd: subSrc, agentDir });

      expect(files.map((f) => f.content)).toEqual([
        "superproject instructions",
        "submodule instructions",
      ]);
    });

    it("should keep climbing past an ordinary repo root", () => {
      const outer = joinPath(tempDir, "outer");
      const repo = joinPath(outer, "repo");
      const leaf = joinPath(repo, "src");
      mkdirSync(leaf, { recursive: true });
      mkdirSync(joinPath(repo, ".git"), { recursive: true });
      writeFileSync(joinPath(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(joinPath(outer, "AGENTS.md"), "outer instructions");
      writeFileSync(joinPath(repo, "AGENTS.md"), "repo instructions");
      writeFileSync(joinPath(leaf, "AGENTS.md"), "leaf instructions");

      const files = loadProjectContextFiles({ cwd: leaf, agentDir });

      expect(files.map((f) => f.content)).toEqual([
        "outer instructions",
        "repo instructions",
        "leaf instructions",
      ]);
    });

    it("should climb normally when the gitdir: target does not exist", () => {
      const repo = joinPath(tempDir, "corrupt");
      const src = joinPath(repo, "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(joinPath(repo, ".git"), "gitdir: /nonexistent/path/worktrees/feat\n");
      writeFileSync(joinPath(repo, "AGENTS.md"), "repo instructions");
      writeFileSync(joinPath(src, "AGENTS.md"), "src instructions");

      const files = loadProjectContextFiles({ cwd: src, agentDir });

      expect(files.map((f) => f.content)).toEqual(["repo instructions", "src instructions"]);
    });
  });
});
