import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import platform from "../src/core/platform/index.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();
const { readEnv } = platform;

const { awaited, joinPath, makeDirectory, makeSymlink, runTest, toJsonText, writeTextFile } =
  testing;

const shouldReturnNoPackageSourcedPathsWhen = Effect.gen(function* () {
  const result = yield* awaited(fixture.packageManager.resolution.resolve());
  expect(result.extensions).toEqual([]);
  expect(result.prompts).toEqual([]);
  expect(result.themes).toEqual([]);
  expect(
    result.skills.every((r) => r.metadata.source === "auto" && r.metadata.origin === "top-level"),
  ).toBe(true);
});

const shouldResolveLocalExtensionPathsFromSettings = Effect.gen(function* () {
  const extDir = joinPath(fixture.agentDir, "extensions");
  yield* makeDirectory(extDir);
  const extPath = joinPath(extDir, "my-extension.ts");
  yield* writeTextFile(extPath, "export default function() {}");
  fixture.settingsManager.resources.setExtensionPaths(["extensions/my-extension.ts"]);

  const result = yield* awaited(fixture.packageManager.resolution.resolve());
  expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
});

const shouldResolveBuiltInExtensionsWithUser = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const pm = new DefaultPackageManager({
    agentDir: fixture.agentDir,
    builtinExtensions: ["mcp", "llama.cpp"],
    cwd: fixture.tempDir,
    settingsManager: fixture.settingsManager,
  });
  const builtins = () =>
    effectRunPromise(
      Effect.gen(function* () {
        return (yield* awaited(pm.resolution.resolve())).extensions.map((r) => [
          r.path,
          r.enabled,
          r.metadata.source,
          r.metadata.scope,
        ]);
      }),
    );

  expect(yield* awaited(builtins())).toEqual([
    ["builtin:mcp", true, "builtin", "user"],
    ["builtin:llama.cpp", true, "builtin", "user"],
  ]);

  fixture.settingsManager.resources.setExtensionPaths(["-builtin:mcp"]);
  fixture.settingsManager.resources.setProjectExtensionPaths([
    "+builtin:mcp",
    "-builtin:llama.cpp",
  ]);
  expect(yield* awaited(builtins())).toEqual([
    ["builtin:mcp", true, "builtin", "project"],
    ["builtin:llama.cpp", false, "builtin", "project"],
  ]);

  fixture.settingsManager.resources.setProjectExtensionPaths([]);
  expect(yield* awaited(builtins())).toEqual([
    ["builtin:mcp", false, "builtin", "user"],
    ["builtin:llama.cpp", true, "builtin", "user"],
  ]);
});

const shouldResolveSkillPathsFromSettings = Effect.gen(function* () {
  const skillDir = joinPath(fixture.agentDir, "skills", "my-skill");
  yield* makeDirectory(skillDir);
  const skillFile = joinPath(skillDir, "SKILL.md");
  yield* writeTextFile(
    skillFile,
    `---
name: test-skill
description: A test skill
---
Content`,
  );

  fixture.settingsManager.resources.setSkillPaths(["skills"]);

  const result = yield* awaited(fixture.packageManager.resolution.resolve());

  expect(result.skills.some((r) => r.path === skillFile && r.enabled)).toBe(true);
});

const shouldAutoDiscoverRootMarkdownSkillsFrom = Effect.gen(function* () {
  const skillFile = joinPath(fixture.agentDir, "skills", "single-file.md");
  yield* makeDirectory(joinPath(fixture.agentDir, "skills"));
  yield* writeTextFile(
    skillFile,
    `---
name: single-file
description: A root markdown skill
---
Content`,
  );

  const result = yield* awaited(fixture.packageManager.resolution.resolve());
  expect(result.skills.some((r) => r.path === skillFile && r.enabled)).toBe(true);
});

const shouldResolveProjectPathsRelativeToMsa = Effect.gen(function* () {
  const extDir = joinPath(fixture.tempDir, ".msa", "extensions");
  yield* makeDirectory(extDir);
  const extPath = joinPath(extDir, "project-ext.ts");
  yield* writeTextFile(extPath, "export default function() {}");

  fixture.settingsManager.resources.setProjectExtensionPaths(["extensions/project-ext.ts"]);

  const result = yield* awaited(fixture.packageManager.resolution.resolve());
  expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
});

const shouldAutoDiscoverUserPromptsWithOverrides = Effect.gen(function* () {
  const promptsDir = joinPath(fixture.agentDir, "prompts");
  yield* makeDirectory(promptsDir);
  const promptPath = joinPath(promptsDir, "auto.md");
  yield* writeTextFile(promptPath, "Auto prompt");

  fixture.settingsManager.resources.setPromptTemplatePaths(["!prompts/auto.md"]);

  const result = yield* awaited(fixture.packageManager.resolution.resolve());
  expect(result.prompts.some((r) => r.path === promptPath && !r.enabled)).toBe(true);
});

const writeSharedResources = (sharedDir: string) =>
  Effect.gen(function* () {
    const shared = {
      extensions: joinPath(sharedDir, "extensions"),
      prompts: joinPath(sharedDir, "prompts"),
      skills: joinPath(sharedDir, "skills"),
      themes: joinPath(sharedDir, "themes"),
    };
    for (const dir of Object.values(shared)) yield* makeDirectory(dir);
    yield* writeTextFile(joinPath(shared.extensions, "shared.ts"), "export default function() {}");
    yield* makeDirectory(joinPath(shared.skills, "shared-skill"));
    yield* writeTextFile(
      joinPath(shared.skills, "shared-skill", "SKILL.md"),
      `---
name: shared-skill
description: Shared skill
---
Content`,
    );
    yield* writeTextFile(joinPath(shared.prompts, "shared.md"), "Shared prompt");
    yield* writeTextFile(
      joinPath(shared.themes, "shared.json"),
      yield* toJsonText({ name: "shared-theme" }),
    );
    return shared;
  });

const shouldResolveSymlinkedUserAndProjectResources = Effect.gen(function* () {
  const previousHome = readEnv("HOME");
  vi.stubEnv("HOME", fixture.tempDir);

  try {
    const shared = yield* writeSharedResources(joinPath(fixture.tempDir, "shared-resources"));
    yield* makeDirectory(joinPath(fixture.agentDir));
    yield* makeDirectory(joinPath(fixture.tempDir, ".msa"));
    for (const root of [fixture.agentDir, joinPath(fixture.tempDir, ".msa")])
      for (const [kind, dir] of Object.entries(shared))
        yield* makeSymlink(dir, joinPath(root, kind));

    const result = yield* awaited(fixture.packageManager.resolution.resolve());

    expect({
      extensions: result.extensions.length,
      prompts: result.prompts.length,
      skills: result.skills.length,
      themes: result.themes.length,
    }).toEqual({
      extensions: 1,
      prompts: 1,
      skills: 1,
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
});

describe("DefaultPackageManager", () => {
  describe("resolve", () => {
    it("should return no package-sourced paths when no sources configured", () =>
      runTest(shouldReturnNoPackageSourcedPathsWhen));

    it("should resolve local extension paths from settings", () =>
      runTest(shouldResolveLocalExtensionPathsFromSettings));

    it("should resolve built-in extensions with user exclusions and project overrides", () =>
      runTest(shouldResolveBuiltInExtensionsWithUser));

    it("should resolve skill paths from settings", () =>
      runTest(shouldResolveSkillPathsFromSettings));

    it("should auto-discover root markdown skills from .msa skill dirs", () =>
      runTest(shouldAutoDiscoverRootMarkdownSkillsFrom));

    it("should resolve project paths relative to .msa", () =>
      runTest(shouldResolveProjectPathsRelativeToMsa));

    it("should auto-discover user prompts with overrides", () =>
      runTest(shouldAutoDiscoverUserPromptsWithOverrides));

    it("should resolve symlinked user and project resources once", () =>
      runTest(shouldResolveSymlinkedUserAndProjectResources));
  });
});
