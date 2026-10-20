import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import config from "../src/config.ts";
import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { getThemesDir } = config;
const {
  awaited,
  currentTimeMillis,
  fromJsonText,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const shouldKeepPackageMetadataForSkillsPromptsStep1 = () =>
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
    return { baseTheme, extensionPromptsDir, extensionSkillDir, extensionThemesDir };
  });

const shouldKeepPackageMetadataForSkillsPromptsStep2 = (input: {
  readonly baseTheme: { name: string };
  readonly extensionPromptsDir: string;
  readonly extensionSkillDir: string;
  readonly extensionThemesDir: string;
}) =>
  Effect.gen(function* () {
    const { baseTheme, extensionPromptsDir, extensionSkillDir, extensionThemesDir } = input;
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
  });

const shouldKeepPackageMetadataForSkillsPromptsStep3 = () =>
  Effect.gen(function* () {
    const { baseTheme, extensionPromptsDir, extensionSkillDir, extensionThemesDir } =
      yield* shouldKeepPackageMetadataForSkillsPromptsStep1();
    yield* shouldKeepPackageMetadataForSkillsPromptsStep2({
      baseTheme,
      extensionPromptsDir,
      extensionSkillDir,
      extensionThemesDir,
    });
    return { extensionPromptsDir, extensionSkillDir, extensionThemesDir };
  });

const shouldKeepPackageMetadataForSkillsPrompts = Effect.gen(function* () {
  const { extensionPromptsDir, extensionSkillDir, extensionThemesDir } =
    yield* shouldKeepPackageMetadataForSkillsPromptsStep3();

  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    settingsManager: SettingsManager.inMemory({ packages: ["npm:metadata-pkg"] }),
  });
  yield* awaited(loader.reload());

  const extensionMetadata = {
    origin: "top-level",
    scope: "temporary",
    source: "extension:discovery",
  } as const;
  loader.extendResources({
    promptPaths: [{ metadata: extensionMetadata, path: extensionPromptsDir }],
    skillPaths: [{ metadata: extensionMetadata, path: extensionSkillDir }],
    themePaths: [{ metadata: extensionMetadata, path: extensionThemesDir }],
  });

  const packageSourceInfo = {
    origin: "package",
    scope: "user",
    source: "npm:metadata-pkg",
  };
  expect(
    loader.getSkills().skills.find((skill) => skill.name === "package-skill")?.sourceInfo,
  ).toMatchObject(packageSourceInfo);
  expect(
    loader.getPrompts().prompts.find((prompt) => prompt.name === "package-prompt")?.sourceInfo,
  ).toMatchObject(packageSourceInfo);
  expect(
    loader.getThemes().themes.find((theme) => theme.name === "package-theme")?.sourceInfo,
  ).toMatchObject(packageSourceInfo);

  expect(
    loader.getSkills().skills.find((skill) => skill.name === "extension-skill")?.sourceInfo,
  ).toMatchObject(extensionMetadata);
  expect(
    loader.getPrompts().prompts.find((prompt) => prompt.name === "extension-prompt")?.sourceInfo,
  ).toMatchObject(extensionMetadata);
  expect(
    loader.getThemes().themes.find((theme) => theme.name === "extension-theme")?.sourceInfo,
  ).toMatchObject(extensionMetadata);
});

const beforeEachHook = Effect.gen(function* () {
  tempDir = joinPath(tmpdir(), `rl-test-${currentTimeMillis()}-${randomSuffixSync()}`);
  agentDir = joinPath(tempDir, "agent");
  cwd = joinPath(tempDir, "project");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(cwd);
});

describe("DefaultResourceLoader", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("extendResources", () => {
    it("should keep package metadata for skills, prompts, and themes", () =>
      runTest(shouldKeepPackageMetadataForSkillsPrompts));
  });
});
