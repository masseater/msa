import { describe, expect, test } from "vite-plus/test";

import systemPrompt from "../src/core/system-prompt.ts";

const { buildSystemPrompt } = systemPrompt;

const showsNoneForEmptyToolsList = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    selectedTools: [],
    skills: [],
  });

  expect(prompt).toContain("<tools>\n(none)\n");
};

const showsFilePathsGuidelineEvenWithNo = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    selectedTools: [],
    skills: [],
  });

  expect(prompt).toContain("Show file paths clearly");
};

const keepsTheDefaultAndCustomPromptPrefixes = () => {
  const defaultPrompt = buildSystemPrompt({
    contextFiles: [],
    cwd: "/tmp",
    selectedTools: [],
    skills: [],
  });
  const customPrompt = buildSystemPrompt({
    contextFiles: [],
    customPrompt: "You are Exact.",
    cwd: "/tmp",
    selectedTools: [],
    skills: [],
  });

  expect(defaultPrompt.startsWith("You are an expert coding assistant operating inside msa")).toBe(
    true,
  );
  expect(customPrompt.startsWith("You are Exact.\n\n<cwd>")).toBe(true);
};

const preservesAnExactForcedPromptWithoutSections = () => {
  expect(buildSystemPrompt({ cwd: "/tmp", forceSystemPrompt: "exact" })).toBe("exact");
};

const mapsAppendedInstructionsAndProjectContextTo = () => {
  const prompt = buildSystemPrompt({
    appendSystemPrompt: "Additional instructions.",
    contextFiles: [{ content: "Project instructions.", path: "/tmp/AGENTS.md" }],
    customPrompt: "You are Exact.",
    cwd: "/tmp",
    selectedTools: [],
    skills: [],
  });

  expect(prompt).toContain("<addendum>\nAdditional instructions.\n</addendum>");
  expect(prompt).toContain(
    '<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/tmp/AGENTS.md">',
  );
  expect(prompt).toContain("<cwd>\n/tmp\n</cwd>");
};

const includesAllDefaultToolsWhenSnippetsAre = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    skills: [],
    toolSnippets: {
      bash: "Execute bash commands",
      edit: "Make surgical edits",
      read: "Read file contents",
      write: "Create or overwrite files",
    },
  });

  expect(prompt).toContain("- read:");
  expect(prompt).toContain("- bash:");
  expect(prompt).toContain("- edit:");
  expect(prompt).toContain("- write:");
};

const instructsModelsToResolveMsaDocsAnd = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    skills: [],
  });

  expect(prompt).toContain(
    "- When reading msa docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory",
  );
  expect(prompt).toContain(
    "environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md)",
  );
};

const includesCustomToolsInAvailableToolsSection = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    selectedTools: ["read", "dynamic_tool"],
    skills: [],
    toolSnippets: {
      dynamic_tool: "Run dynamic test behavior",
    },
  });

  expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
};

const omitsCustomToolsFromAvailableToolsSection = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    selectedTools: ["read", "dynamic_tool"],
    skills: [],
  });

  expect(prompt).not.toContain("dynamic_tool");
};

describe("buildSystemPrompt", () => {
  describe("empty tools", () => {
    test("shows (none) for empty tools list", showsNoneForEmptyToolsList);

    test("shows file paths guideline even with no tools", showsFilePathsGuidelineEvenWithNo);
  });

  describe("prompt structure", () => {
    test(
      "keeps the default and custom prompt prefixes exact",
      keepsTheDefaultAndCustomPromptPrefixes,
    );

    test(
      "preserves an exact forced prompt without sections",
      preservesAnExactForcedPromptWithoutSections,
    );

    test(
      "maps appended instructions and project context to stable sections",
      mapsAppendedInstructionsAndProjectContextTo,
    );
  });
});

describe("buildSystemPrompt", () => {
  describe("default tools", () => {
    test(
      "includes all default tools when snippets are provided",
      includesAllDefaultToolsWhenSnippetsAre,
    );

    test.each([
      [["powershell"], "Use PowerShell for file operations"],
      [["bash", "powershell"], "Use bash or PowerShell for file operations"],
    ] as const)("uses shell-specific guidance for %j", (selectedTools, expected) => {
      const prompt = buildSystemPrompt({
        contextFiles: [],
        cwd: process.cwd(),
        selectedTools: [...selectedTools],
        skills: [],
      });

      expect(prompt).toContain(expected);
    });

    test(
      "instructs models to resolve msa docs and examples under absolute base paths",
      instructsModelsToResolveMsaDocsAnd,
    );
  });

  describe("custom tool snippets", () => {
    test(
      "includes custom tools in available tools section when promptSnippet is provided",
      includesCustomToolsInAvailableToolsSection,
    );

    test(
      "omits custom tools from available tools section when promptSnippet is not provided",
      omitsCustomToolsFromAvailableToolsSection,
    );
  });
});
