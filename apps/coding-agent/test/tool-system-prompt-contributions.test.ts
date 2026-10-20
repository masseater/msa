import { describe, expect, test } from "vite-plus/test";

import bash from "../src/core/tools/bash.ts";
import edit from "../src/core/tools/edit.ts";
import find from "../src/core/tools/find.ts";
import grep from "../src/core/tools/grep.ts";
import ls from "../src/core/tools/ls.ts";
import powershell from "../src/core/tools/powershell.ts";
import read from "../src/core/tools/read.ts";
import write from "../src/core/tools/write.ts";

const { createReadToolDefinition, readToolSystemPromptContribution } = read;
const { bashToolSystemPromptContribution, createBashToolDefinition } = bash;
const { createPowerShellToolDefinition, powershellToolSystemPromptContribution } = powershell;
const { createEditToolDefinition, editToolSystemPromptContribution } = edit;
const { createWriteToolDefinition, writeToolSystemPromptContribution } = write;
const { createGrepToolDefinition, grepToolSystemPromptContribution } = grep;
const { createFindToolDefinition, findToolSystemPromptContribution } = find;
const { createLsToolDefinition, lsToolSystemPromptContribution } = ls;

interface ContributionCase {
  readonly 0: string;
  readonly 1: { readonly snippet: string; readonly guidelines: readonly string[] };
  readonly 2: (cwd: string) => {
    readonly promptGuidelines?: readonly string[] | undefined;
    readonly promptSnippet?: string | undefined;
  };
}

const cases: readonly (readonly [ContributionCase[0], ContributionCase[1], ContributionCase[2]])[] =
  [
    ["read", readToolSystemPromptContribution, createReadToolDefinition],
    ["bash", bashToolSystemPromptContribution, createBashToolDefinition],
    ["powershell", powershellToolSystemPromptContribution, createPowerShellToolDefinition],
    ["edit", editToolSystemPromptContribution, createEditToolDefinition],
    ["write", writeToolSystemPromptContribution, createWriteToolDefinition],
    ["grep", grepToolSystemPromptContribution, createGrepToolDefinition],
    ["find", findToolSystemPromptContribution, createFindToolDefinition],
    ["ls", lsToolSystemPromptContribution, createLsToolDefinition],
  ];

describe("built-in tool system prompt contributions", () => {
  test.each(cases)(
    "keeps the %s tool definition aligned with its contribution",
    (_name, contribution, createDefinition) => {
      const definition = createDefinition("/workspace");

      expect(definition.promptSnippet).toBe(contribution.snippet);
      expect(definition.promptGuidelines ?? []).toEqual(contribution.guidelines);
    },
  );

  test.each([
    ["bash", createBashToolDefinition],
    ["powershell", createPowerShellToolDefinition],
  ] as const)("keeps %s session-environment guidance conditional", (_name, createDefinition) => {
    const definition = createDefinition("/workspace", { exposeSessionEnvironment: false });

    expect(definition.promptGuidelines).toBeUndefined();
  });
});
