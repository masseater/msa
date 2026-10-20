import type agentTypes from "@msa/agent-core/index.types";
import testing from "@msa/testing";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import codemodeTool from "../src/extensions/codemode/tool.ts";
import Bm25Ranker from "../src/extensions/tool-search/bm-25-ranker.ts";
import tokenizeModule from "../src/extensions/tool-search/tokenize.ts";
import toolModule from "../src/extensions/tool-search/tool.ts";

const { createToolSearchDocument } = toolModule;
const { tokenize } = tokenizeModule;
const { createCodemodeDescription } = codemodeTool;

const { awaited, runTest } = testing;

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
): agentTypes.AgentTool {
  return {
    description,
    execute: () => runTest(awaited({ content: [], details: undefined })),
    label: name,
    name,
    parameters: Type.Unsafe({ properties, type: "object" }),
  };
}

const splitsCamelcaseAndSnakeCaseDropsStop = () => {
  expect(tokenize("listIssues for the GitHub_repo")).toEqual([
    "list",
    "issue",
    "git",
    "hub",
    "repo",
  ]);
  expect(tokenize("searches queries HTTPServer")).toEqual(["search", "query", "http", "server"]);
};

describe("tokenize", () => {
  it(
    "splits camelCase and snake_case, drops stop words, and folds plurals",
    splitsCamelcaseAndSnakeCaseDropsStop,
  );
});

const tools = [
  tool("mcp__github__list_issues", "List issues in a repository.", {
    state: { description: "open or closed", type: "string" },
  }),
  tool("mcp__github__create_pull_request", "Open a pull request."),
  tool("mcp__linear__search_issues", "Search Linear issues by text."),
  tool("mcp__docs__search", "Search the documentation."),
];

const documents = tools.map((entry) => createToolSearchDocument(entry));

const ranksByTermRelevanceAndRespectsThe = () => {
  const ranker = new Bm25Ranker();
  expect(ranker.rank("issue", documents, 8).map((match) => match.name)).toEqual([
    "mcp__linear__search_issues",
    "mcp__github__list_issues",
  ]);
  expect(ranker.rank("pull requests", documents, 8)[0]?.name).toBe(
    "mcp__github__create_pull_request",
  );
  expect(ranker.rank("search", documents, 1)).toHaveLength(1);

  expect(ranker.rank("closed", documents, 8).map((match) => match.name)).toEqual([
    "mcp__github__list_issues",
  ]);
};

const returnsNothingForUnknownOrEmptyQueries = () => {
  const ranker = new Bm25Ranker();
  expect(ranker.rank("kubernetes", documents, 8)).toEqual([]);
  expect(ranker.rank("the", documents, 8)).toEqual([]);

  expect(ranker.rank("tickets", documents, 8)).toEqual([]);
};

const includesTheNamespaceInTheSearchText = () => {
  const document = createToolSearchDocument(tool("mcp__x__run", "Run it."), {
    description: "Kubernetes cluster tools",
    name: "mcp__x",
  });
  expect(new Bm25Ranker().rank("kubernetes", [document], 8)).toEqual([
    { name: "mcp__x__run", score: expect.any(Number) },
  ]);
};

describe("Bm25Ranker", () => {
  it("ranks by term relevance and respects the limit", ranksByTermRelevanceAndRespectsThe);

  it("returns nothing for unknown or empty queries", returnsNothingForUnknownOrEmptyQueries);

  it("includes the namespace in the search text", includesTheNamespaceInTheSearchText);
});

const plain = tool("read_notes", "Read notes.");

const github = ["a", "b", "c"].map((suffix) => tool(`mcp__github__${suffix}`, `GitHub ${suffix}.`));

const docs = [
  tool("mcp__docs__search", "Search docs."),
  tool("mcp__docs__long", "Long ".repeat(200)),
];

const all = [plain, ...github, ...docs];

const namespaces = new Map<string, extensionsTypesTypes.ToolNamespace>([
  ...github.map(
    (entry) => [entry.name, { description: "GitHub server", name: "mcp__github" }] as const,
  ),
  ...docs.map((entry) => [entry.name, { name: "mcp__docs" }] as const),
]);

const listsEverythingWithoutABudget = () => {
  const description = createCodemodeDescription(all, { namespaces });
  expect(description).toContain("Nested tools:");
  expect(description).toContain("## mcp__github\nGitHub server");
  expect(description).toContain("## mcp__docs\n\n### `mcp__docs");

  expect(description).toContain("find unlisted tools, such as MCP tools");

  expect(description).toContain("`await searchTools(query, { limit?, namespace? })`");
  expect(description).toContain("`await describeTool(name)`");
  expect(description).toContain("`await describeNamespace(name)`");
};

const fillsTheBudgetRoundRobinCheapestFirst = () => {
  const description = createCodemodeDescription(all, { inlineBudget: 170, namespaces });
  expect(description).toContain("### `read_notes`");
  expect(description).toContain("## mcp__docs (some tools not listed)");
  expect(description).toContain("### `mcp__docs__search`");
  expect(description).not.toContain("### `mcp__docs__long`");
  expect(description).toContain("## mcp__github (some tools not listed)");
  expect(description).toContain("find unlisted tools, such as MCP tools");

  expect(createCodemodeDescription(all, { inlineBudget: 170, namespaces })).toBe(description);
};

const leavesDeferredToolsAndTheirNamespacesOut = () => {
  const deferred = new Set(github.map((entry) => entry.name));
  const description = createCodemodeDescription(all, { deferred, namespaces });
  expect(description).not.toContain("mcp__github");

  expect(description).toBe(createCodemodeDescription([plain, ...docs], { namespaces }));
};

const leavesNamespaceInstructionsOut = () => {
  const description = createCodemodeDescription(github, {
    namespaces: new Map(
      github.map(
        (entry) =>
          [entry.name, { instructions: "Long usage guide.", name: "mcp__github" }] as const,
      ),
    ),
  });
  expect(description).toContain("## mcp__github\n\n### `mcp__github__a`");
  expect(description).not.toContain("Long usage guide.");
};

const listsOnlyNamespacesWithAZeroBudget = () => {
  const description = createCodemodeDescription(all, { inlineBudget: 0, namespaces });
  expect(description).toContain("## mcp__docs (tools not listed)");
  expect(description).not.toContain("codemode tool declaration:");
};

describe("codemode description catalog", () => {
  it("lists everything without a budget", listsEverythingWithoutABudget);

  it(
    "fills the budget round-robin, cheapest first, and says what is missing",
    fillsTheBudgetRoundRobinCheapestFirst,
  );

  it(
    "leaves deferred tools and their namespaces out entirely",
    leavesDeferredToolsAndTheirNamespacesOut,
  );

  it("leaves namespace instructions out", leavesNamespaceInstructionsOut);

  it("lists only namespaces with a zero budget", listsOnlyNamespacesWithAZeroBudget);
});
