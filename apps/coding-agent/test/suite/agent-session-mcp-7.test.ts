import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";

const { cleanupAll } = harnessModule;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { declaredToolNames, harnesses, nestedToolNames, serversSection, setup, setupSlow } =
  agentSessionMcpSupport;

const { getAssistantTexts, getMessageText, getToolResult: toolResult } = harnessModule;

const { fromJsonText } = testing;

const waitsForServersWithDirectTools = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setupSlow(
      { exposure: "direct", instructions: "Slow docs.", toolExposure: { shot: "codemode" } },
      30,
    ),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(serversSection(harness)).toContain("- mcp__slow (codemode): Slow docs.");
});

const leavesServersWithOnlyDirectTools = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({ exposure: "direct" }, 0));
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(serversSection(harness)).toBeUndefined();
});

const waitsForTheServersACodemode = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() => setupSlow({}, 30));
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `return (await tools.mcp__slow__search({ query: "q" })).structuredContent;`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const result = toolResult(harness, "codemode");
  expect(result.isError).toBe(false);
  expect(yield* fromJsonText(getMessageText(result).split("\n").at(-1) ?? "")).toEqual({
    hits: ["q guide", "q faq"],
  });
  expect(calls).toEqual(['search:{"query":"q"}']);
});

const waitsForServersWhoseScriptIdentifiers = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() => setupSlow({ name: "slow-docs" }, 30));
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `await tools.mcp__slow_docs__search({ query: "q" });
const names = ["slow-docs", "slow_docs", "mcp__slow-docs", "mcp__slow_docs"];
return [...new Set(await Promise.all(names.map(async (name) => (await describeNamespace(name))?.name)))];`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  expect(toolResult(harness, "codemode").isError).toBe(false);
  expect(getMessageText(toolResult(harness, "codemode")).split("\n").at(-1)).toBe(
    '["mcp__slow_docs"]',
  );
  expect(calls).toEqual(['search:{"query":"q"}']);
});

const doesNotWaitForServersA = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({}, Number.POSITIVE_INFINITY));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("codemode", { code: "return 1 + 1;" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  expect(getMessageText(toolResult(harness, "codemode")).split("\n").at(-1)).toBe("2");
});

const waitsForServersBeforeToolSearch = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({ exposure: "deferred" }, 30));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { limit: 1, query: "search the docs" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxToolCall("mcp__slow__search", { query: "late" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  expect(getMessageText(toolResult(harness, "mcp__slow__search"))).toBe("late guide\nlate faq");
});

const holdsTheFirstPromptForServers = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({ exposure: "direct" }, 30));
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(declaredToolNames(harness)).toContain("mcp__slow__search");
});

const holdsTheFirstPromptForServers2 = Effect.gen(function* () {
  const { harness, notifications } = yield* Effect.promise(() =>
    setupSlow({ exposure: "direct" }, Number.POSITIVE_INFINITY, 20),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(getAssistantTexts(harness)).toEqual(["ready"]);
  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual([]);
  expect(notifications).toEqual([
    "MCP servers are still connecting; their tools become available once connected.",
  ]);
});

const doesNotLetCodemodeCallItself = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setup("direct"));
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));
  harness.session.tools.loadout.setActiveToolsByName(["codemode", "mcp__docs__search"]);

  expect(nestedToolNames(harness)).toEqual(["mcp__docs__search"]);
});

const findsToolsFromScriptsWithSearchtools = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() => setup("codemode"));
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `
							const [match] = await searchTools("search the docs", { limit: 1 });
							const none = await searchTools("docs", { namespace: "mcp__other" });
							const declaration = await describeTool(match.name);
							const result = await tools[match.name]({ query: "found" });
							text(JSON.stringify({
								name: match.name,
								sameAsAllTools: ALL_TOOLS.find((tool) => tool.name === match.name).description === match.description,
								none: none.length,
								declared: declaration.includes("codemode tool declaration:"),
								missing: (await describeTool("nope")) === undefined,
								hits: result.structuredContent.hits,
							}));
						`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const result = toolResult(harness, "codemode");
  expect(result.isError).toBe(false);
  expect(yield* fromJsonText((result.content[1] as { text: string }).text)).toEqual({
    declared: true,
    hits: ["found guide", "found faq"],
    missing: true,
    name: "mcp__docs__search",
    none: 0,
    sameAsAllTools: true,
  });
  expect(calls).toEqual(['search:{"query":"found"}']);
});

const waitsForServersWithDirectToolsBefore = () =>
  Effect.runPromise(waitsForServersWithDirectTools);

const leavesServersWithOnlyDirectToolsOut = () =>
  Effect.runPromise(leavesServersWithOnlyDirectTools);

const waitsForTheServersACodemodeScript = () => Effect.runPromise(waitsForTheServersACodemode);

const waitsForServersWhoseScriptIdentifiersDiffer = () =>
  Effect.runPromise(waitsForServersWhoseScriptIdentifiers);

const doesNotWaitForServersACodemode = () => Effect.runPromise(doesNotWaitForServersA);

const waitsForServersBeforeToolSearchSearches = () =>
  Effect.runPromise(waitsForServersBeforeToolSearch);

const holdsTheFirstPromptForServersWith = () => Effect.runPromise(holdsTheFirstPromptForServers);

const holdsTheFirstPromptForServersWith2 = () => Effect.runPromise(holdsTheFirstPromptForServers2);

const doesNotLetCodemodeCallItselfOr = () => Effect.runPromise(doesNotLetCodemodeCallItself);

const findsToolsFromScriptsWithSearchtoolsAnd = () =>
  Effect.runPromise(findsToolsFromScriptsWithSearchtools);

describe("AgentSession MCP integration", () => {
  afterEach(() => cleanupAll(harnesses));

  it(
    "waits for servers with direct tools before listing the servers",
    waitsForServersWithDirectToolsBefore,
  );

  it(
    "leaves servers with only direct tools out of the servers section",
    leavesServersWithOnlyDirectToolsOut,
  );

  it("waits for the servers a codemode script names", waitsForTheServersACodemodeScript);

  it(
    "waits for servers whose script identifiers differ from their names",
    waitsForServersWhoseScriptIdentifiersDiffer,
  );

  it("does not wait for servers a codemode script does not name", doesNotWaitForServersACodemode);

  it("waits for servers before tool_search searches", waitsForServersBeforeToolSearchSearches);

  it("holds the first prompt for servers with direct tools", holdsTheFirstPromptForServersWith);

  it(
    "holds the first prompt for servers with direct tools only up to startupWaitMs",
    holdsTheFirstPromptForServersWith2,
  );

  it("does not let codemode call itself or inactive direct tools", doesNotLetCodemodeCallItselfOr);

  it(
    "finds tools from scripts with searchTools() and describeTool()",
    findsToolsFromScriptsWithSearchtoolsAnd,
  );
});
