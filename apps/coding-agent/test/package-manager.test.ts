import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { Effect } from "effect";
import { nodeFs } from "./package-manager-support.ts";
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

  describe("resolve", () => {
    it("should return no package-sourced paths when no sources configured", () => runTest(
Effect.gen(function* () {

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.extensions).toEqual([]);
      expect(result.prompts).toEqual([]);
      expect(result.themes).toEqual([]);
      expect(
        result.skills.every(
          (r) => r.metadata.source === "auto" && r.metadata.origin === "top-level",
        ),
      ).toBe(true);
    
}),
));

    it("should resolve local extension paths from settings", () => runTest(
Effect.gen(function* () {

      const extDir = joinPath(agentDir, "extensions");
      (yield* makeDirectory(extDir));
      const extPath = joinPath(extDir, "my-extension.ts");
      (yield* writeTextFile(extPath, "export default function() {}"));
      settingsManager.setExtensionPaths(["extensions/my-extension.ts"]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    
}),
));

    it("should resolve built-in extensions with user exclusions and project overrides", () => runTest(
Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const pm = new DefaultPackageManager({
        cwd: tempDir,
        agentDir,
        settingsManager,
        builtinExtensions: ["mcp", "llama.cpp"],
      });
      const builtins = () =>
        effectRunPromise(
Effect.gen(function* () {
return ((yield* awaited(pm.resolve()))).extensions.map((r) => [
          r.path,
          r.enabled,
          r.metadata.source,
          r.metadata.scope,
        ]);
}),
);

      expect((yield* awaited(builtins()))).toEqual([
        ["builtin:mcp", true, "builtin", "user"],
        ["builtin:llama.cpp", true, "builtin", "user"],
      ]);

      settingsManager.setExtensionPaths(["-builtin:mcp"]);
      settingsManager.setProjectExtensionPaths(["+builtin:mcp", "-builtin:llama.cpp"]);
      expect((yield* awaited(builtins()))).toEqual([
        ["builtin:mcp", true, "builtin", "project"],
        ["builtin:llama.cpp", false, "builtin", "project"],
      ]);

      settingsManager.setProjectExtensionPaths([]);
      expect((yield* awaited(builtins()))).toEqual([
        ["builtin:mcp", false, "builtin", "user"],
        ["builtin:llama.cpp", true, "builtin", "user"],
      ]);
    
}),
));

    it("should resolve skill paths from settings", () => runTest(
Effect.gen(function* () {

      const skillDir = joinPath(agentDir, "skills", "my-skill");
      (yield* makeDirectory(skillDir));
      const skillFile = joinPath(skillDir, "SKILL.md");
      (yield* writeTextFile(skillFile, `---
name: test-skill
description: A test skill
---
Content`));

      settingsManager.setSkillPaths(["skills"]);

      const result = (yield* awaited(packageManager.resolve()));

      expect(result.skills.some((r) => r.path === skillFile && r.enabled)).toBe(true);
    
}),
));

    it("should auto-discover root markdown skills from .msa skill dirs", () => runTest(
Effect.gen(function* () {

      const skillFile = joinPath(agentDir, "skills", "single-file.md");
      (yield* makeDirectory(joinPath(agentDir, "skills")));
      (yield* writeTextFile(skillFile, `---
name: single-file
description: A root markdown skill
---
Content`));

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.skills.some((r) => r.path === skillFile && r.enabled)).toBe(true);
    
}),
));

    it("should resolve project paths relative to .msa", () => runTest(
Effect.gen(function* () {

      const extDir = joinPath(tempDir, ".msa", "extensions");
      (yield* makeDirectory(extDir));
      const extPath = joinPath(extDir, "project-ext.ts");
      (yield* writeTextFile(extPath, "export default function() {}"));

      settingsManager.setProjectExtensionPaths(["extensions/project-ext.ts"]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    
}),
));

    it("should auto-discover user prompts with overrides", () => runTest(
Effect.gen(function* () {

      const promptsDir = joinPath(agentDir, "prompts");
      (yield* makeDirectory(promptsDir));
      const promptPath = joinPath(promptsDir, "auto.md");
      (yield* writeTextFile(promptPath, "Auto prompt"));

      settingsManager.setPromptTemplatePaths(["!prompts/auto.md"]);

      const result = (yield* awaited(packageManager.resolve()));
      expect(result.prompts.some((r) => r.path === promptPath && !r.enabled)).toBe(true);
    
}),
));

    it("should resolve symlinked user and project resources once", () => runTest(
Effect.gen(function* () {

      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", tempDir);

      try {
        const sharedDir = joinPath(tempDir, "shared-resources");
        const sharedExtensionsDir = joinPath(sharedDir, "extensions");
        const sharedSkillsDir = joinPath(sharedDir, "skills");
        const sharedPromptsDir = joinPath(sharedDir, "prompts");
        const sharedThemesDir = joinPath(sharedDir, "themes");
        (yield* makeDirectory(sharedExtensionsDir));
        (yield* makeDirectory(sharedSkillsDir));
        (yield* makeDirectory(sharedPromptsDir));
        (yield* makeDirectory(sharedThemesDir));

        (yield* writeTextFile(joinPath(sharedExtensionsDir, "shared.ts"), "export default function() {}"));
        (yield* makeDirectory(joinPath(sharedSkillsDir, "shared-skill")));
        (yield* writeTextFile(joinPath(sharedSkillsDir, "shared-skill", "SKILL.md"), `---
name: shared-skill
description: Shared skill
---
Content`));
        (yield* writeTextFile(joinPath(sharedPromptsDir, "shared.md"), "Shared prompt"));
        (yield* writeTextFile(joinPath(sharedThemesDir, "shared.json"), (yield* toJsonText({ name: "shared-theme" }))));

        (yield* makeDirectory(joinPath(agentDir)));
        (yield* makeDirectory(joinPath(tempDir, ".msa")));
        nodeFs.symlinkSync(sharedExtensionsDir, joinPath(agentDir, "extensions"), "dir");
        nodeFs.symlinkSync(sharedSkillsDir, joinPath(agentDir, "skills"), "dir");
        nodeFs.symlinkSync(sharedPromptsDir, joinPath(agentDir, "prompts"), "dir");
        nodeFs.symlinkSync(sharedThemesDir, joinPath(agentDir, "themes"), "dir");
        nodeFs.symlinkSync(sharedExtensionsDir, joinPath(tempDir, ".msa", "extensions"), "dir");
        nodeFs.symlinkSync(sharedSkillsDir, joinPath(tempDir, ".msa", "skills"), "dir");
        nodeFs.symlinkSync(sharedPromptsDir, joinPath(tempDir, ".msa", "prompts"), "dir");
        nodeFs.symlinkSync(sharedThemesDir, joinPath(tempDir, ".msa", "themes"), "dir");

        const result = (yield* awaited(packageManager.resolve()));

        expect({
          extensions: result.extensions.length,
          skills: result.skills.length,
          prompts: result.prompts.length,
          themes: result.themes.length,
        }).toEqual({
          extensions: 1,
          skills: 1,
          prompts: 1,
          themes: 1,
        });

        expect(result.extensions[0]?.metadata.scope).toBe("project");
        expect(result.skills[0]?.metadata.scope).toBe("project");
        expect(result.prompts[0]?.metadata.scope).toBe("project");
        expect(result.themes[0]?.metadata.scope).toBe("project");
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
});
