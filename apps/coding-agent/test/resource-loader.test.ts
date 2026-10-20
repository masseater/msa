import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const shouldInitializeWithEmptyResultsBeforeReload = () => {
  const loader = new DefaultResourceLoader({ agentDir, cwd });

  expect(loader.getExtensions().extensions).toEqual([]);
  expect(loader.getSkills().skills).toEqual([]);
  expect(loader.getPrompts().prompts).toEqual([]);
  expect(loader.getThemes().themes).toEqual([]);
};

const shouldNotTreatAProjectManifestAs = Effect.gen(function* () {
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

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  expect(loader.getExtensions().extensions).toHaveLength(1);
  expect(loader.getExtensions().warnings).toEqual([]);
});

const shouldWarnAboutHostDependenciesInAn = Effect.gen(function* () {
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
    agentDir,
    cwd,
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
});

const shouldFailWhenAnExtensionPackageManifest = Effect.gen(function* () {
  const packageRoot = joinPath(tempDir, "invalid-extension-package");
  const extensionsDir = joinPath(packageRoot, "extensions");
  yield* makeDirectory(extensionsDir);
  yield* writeTextFile(joinPath(packageRoot, "package.json"), "{");
  yield* writeTextFile(
    joinPath(extensionsDir, "package-extension.ts"),
    "export default function() {}",
  );

  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }),
  });

  yield* awaited(expect(loader.reload()).rejects.toThrow(SyntaxError));
});

const shouldDiscoverSkillsFromAgentdir = Effect.gen(function* () {
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

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const { skills } = loader.getSkills();
  expect(skills.some((s) => s.name === "test-skill")).toBe(true);
});

const shouldIgnoreExtraMarkdownFilesInAuto = Effect.gen(function* () {
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

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const { skills, diagnostics } = loader.getSkills();
  expect(skills.some((s) => s.name === "browser-tools")).toBe(true);
  expect(diagnostics.some((d) => d.path?.endsWith("EFFICIENCY.md"))).toBe(false);
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

  describe("reload", () => {
    it(
      "should initialize with empty results before reload",
      shouldInitializeWithEmptyResultsBeforeReload,
    );

    it("should not treat a project manifest as the owner of a project extension", () =>
      runTest(shouldNotTreatAProjectManifestAs));

    it("should warn about host dependencies in an extension package manifest", () =>
      runTest(shouldWarnAboutHostDependenciesInAn));
  });
});

describe("DefaultResourceLoader", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("reload", () => {
    it("should fail when an extension package manifest cannot be parsed", () =>
      runTest(shouldFailWhenAnExtensionPackageManifest));

    it("should discover skills from agentDir", () => runTest(shouldDiscoverSkillsFromAgentdir));

    it("should ignore extra markdown files in auto-discovered skill dirs", () =>
      runTest(shouldIgnoreExtraMarkdownFilesInAuto));
  });
});
