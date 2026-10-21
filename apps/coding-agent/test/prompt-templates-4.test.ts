import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, describe, expect, test } from "vite-plus/test";

import config from "../src/config.ts";
import promptTemplates from "../src/core/prompt-templates.ts";

const { loadPromptTemplates } = promptTemplates;
const { getAgentDir } = config;

const {
  currentTimeMillis,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  tempRoot,
  writeTextFile,
} = testing;

const testDir2 = joinPath(tempRoot(), `msa-test-prompts-${currentTimeMillis()}`);

const writeTemplate = Effect.fn("writeTemplate")(function* (name: string, content: string) {
  yield* makeDirectory(testDir2);
  yield* writeTextFile(joinPath(testDir2, `${name}.md`), content);
});

const shouldParseRequiredArgumentHintFromFrontmatter = Effect.gen(function* () {
  yield* writeTemplate(
    "pr",
    `---
description: Review PRs from URLs with structured issue and code analysis
argument-hint: "<PR-URL>"
---
You are given one or more GitHub PR URLs: $@`,
  );

  const { templates } = yield* Effect.promise(() =>
    loadPromptTemplates({
      agentDir: getAgentDir(),
      cwd: process.cwd(),
      includeDefaults: false,
      promptPaths: [testDir2],
    }),
  );

  const pr = templates.find((t) => t.name === "pr");
  expect(pr).toBeDefined();
  expect(pr!.argumentHint).toBe("<PR-URL>");
  expect(pr!.description).toBe("Review PRs from URLs with structured issue and code analysis");
});

const shouldParseOptionalArgumentHintFromFrontmatter = Effect.gen(function* () {
  yield* writeTemplate(
    "wr",
    `---
description: Finish the current task end-to-end with changelog, commit, and push
argument-hint: "[instructions]"
---
Wrap it. Additional instructions: $ARGUMENTS`,
  );

  const { templates } = yield* Effect.promise(() =>
    loadPromptTemplates({
      agentDir: getAgentDir(),
      cwd: process.cwd(),
      includeDefaults: false,
      promptPaths: [testDir2],
    }),
  );

  const wr = templates.find((t) => t.name === "wr");
  expect(wr).toBeDefined();
  expect(wr!.argumentHint).toBe("[instructions]");
  expect(wr!.description).toBe(
    "Finish the current task end-to-end with changelog, commit, and push",
  );
});

const shouldLeaveArgumenthintUndefinedWhenNotSpecified = Effect.gen(function* () {
  yield* writeTemplate(
    "cl",
    `---
description: Audit changelog entries before release
---
Audit changelog entries for all commits since the last release.`,
  );

  const { templates } = yield* Effect.promise(() =>
    loadPromptTemplates({
      agentDir: getAgentDir(),
      cwd: process.cwd(),
      includeDefaults: false,
      promptPaths: [testDir2],
    }),
  );

  const cl = templates.find((t) => t.name === "cl");
  expect(cl).toBeDefined();
  expect(cl!.argumentHint).toBeUndefined();
});

const shouldIgnoreEmptyArgumentHint = Effect.gen(function* () {
  yield* writeTemplate(
    "empty-hint",
    `---
description: A command with empty hint
argument-hint: ""
---
Do something`,
  );

  const { templates } = yield* Effect.promise(() =>
    loadPromptTemplates({
      agentDir: getAgentDir(),
      cwd: process.cwd(),
      includeDefaults: false,
      promptPaths: [testDir2],
    }),
  );

  const tmpl = templates.find((t) => t.name === "empty-hint");
  expect(tmpl).toBeDefined();
  expect(tmpl!.argumentHint).toBeUndefined();
});

const shouldPreserveArgumentHintWithSpecialCharacters = Effect.gen(function* () {
  yield* writeTemplate(
    "is",
    `---
description: Analyze GitHub issues (bugs or feature requests)
argument-hint: "<issue>"
---
Analyze GitHub issue(s): $ARGUMENTS`,
  );

  const { templates } = yield* Effect.promise(() =>
    loadPromptTemplates({
      agentDir: getAgentDir(),
      cwd: process.cwd(),
      includeDefaults: false,
      promptPaths: [testDir2],
    }),
  );

  const is = templates.find((t) => t.name === "is");
  expect(is).toBeDefined();
  expect(is!.argumentHint).toBe("<issue>");
});

describe("loadPromptTemplates - argument-hint", () => {
  test("should parse required argument-hint from frontmatter", () =>
    runTest(shouldParseRequiredArgumentHintFromFrontmatter));

  test("should parse optional argument-hint from frontmatter", () =>
    runTest(shouldParseOptionalArgumentHintFromFrontmatter));

  test("should leave argumentHint undefined when not specified", () =>
    runTest(shouldLeaveArgumenthintUndefinedWhenNotSpecified));

  test("should ignore empty argument-hint", () => runTest(shouldIgnoreEmptyArgumentHint));

  test("should preserve argument-hint with special characters", () =>
    runTest(shouldPreserveArgumentHintWithSpecialCharacters));

  afterAll(() => runTest(removePath(testDir2).pipe(Effect.ignore)));
});

const reportsInvalidYamlFrontmatterAndKeepsValid = Effect.gen(function* () {
  const testDir = yield* makeTempDir("msa-test-prompts-invalid-");
  const invalidPromptPath = joinPath(testDir, "invalid.md");
  try {
    yield* writeTextFile(
      invalidPromptPath,
      "---\ndescription: Broken: unquoted colon\n---\nDo something.\n",
    );
    yield* writeTextFile(joinPath(testDir, "valid.md"), "Valid prompt content.");

    const { templates, diagnostics } = yield* Effect.promise(() =>
      loadPromptTemplates({
        agentDir: getAgentDir(),
        cwd: process.cwd(),
        includeDefaults: false,
        promptPaths: [testDir],
      }),
    );

    expect(templates.map((template) => template.name)).toEqual(["valid"]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("line 1, column 14"),
        path: invalidPromptPath,
        type: "warning" as const,
      }),
    ]);
  } finally {
    yield* removePath(testDir);
  }
});

describe("loadPromptTemplates - diagnostics", () => {
  test("reports invalid YAML frontmatter and keeps valid siblings", () =>
    runTest(reportsInvalidYamlFrontmatterAndKeepsValid));
});
