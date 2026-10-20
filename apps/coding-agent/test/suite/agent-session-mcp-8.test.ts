import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import toolsModule from "../../src/extensions/mcp/tools.ts";
import toolModule from "../../src/extensions/tool-search/tool.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createMcpToolName } = toolsModule;
const { TOOL_SEARCH_DESCRIPTION } = toolModule;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses, setup } = agentSessionMcpSupport;

const { getMessageText, getToolResult: toolResult } = harnessModule;

const activatesToolSearchForDeferredMcp = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() => setup("deferred"));
  const searchName = createMcpToolName("docs", "search");
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { limit: 1, query: "search the docs" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxToolCall(searchName, { query: "loaded" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("find a docs tool"));
  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual(["tool_search", searchName]);
  const toolSearch = harness.session.agent.state.tools.find((tool) => tool.name === "tool_search");
  expect(toolSearch?.description).toBe(TOOL_SEARCH_DESCRIPTION);
  const search = toolResult(harness, "tool_search");
  expect(getMessageText(search)).toBe(
    `Loaded 1 tool. They are available from your next call:\n- ${searchName}: Search the docs.`,
  );
  const loadMessages = harness.session.messages.filter(
    (message): message is compatTypes.SystemMessage =>
      message.role === "system" &&
      (message.toolsAdded ?? []).some((tool) => tool.name === searchName),
  );
  expect(loadMessages).toHaveLength(1);
  expect(loadMessages[0]?.toolsAdded?.map((tool) => tool.name)).toEqual([searchName]);
  expect(getMessageText(toolResult(harness, searchName))).toBe("loaded guide\nloaded faq");
  expect(calls).toEqual(['search:{"query":"loaded"}']);
  return yield* activatesToolSearchForDeferredMcpStep1(harness, searchName);
});

const activatesToolSearchForDeferredMcpStep1 = (
  harness: harnessTypes.Harness,
  searchName: string,
) =>
  Effect.gen(function* () {
    const branch = harness.sessionManager.getBranch();
    const firstUser = branch.find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );
    const last = branch.at(-1);
    if (firstUser === undefined || last === undefined) throw new Error("Missing entries");
    yield* Effect.promise(() => harness.session.context.tree.navigateTree(firstUser.id));
    expect(harness.session.tools.loadout.getActiveToolNames()).not.toContain(searchName);
    yield* Effect.promise(() => harness.session.context.tree.navigateTree(last.id));
    expect(harness.session.tools.loadout.getActiveToolNames()).toContain(searchName);
  });

const findsNothingToLoadWhenEvery = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("direct", undefined, { builtInTools: ["tool_search"] }),
  );
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { query: "docs" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));
  expect(getMessageText(toolResult(harness, "tool_search"))).toBe("No matching tools found.");
});

const activatesToolSearchForDeferredMcpTools = () =>
  Effect.runPromise(activatesToolSearchForDeferredMcp);

const findsNothingToLoadWhenEveryMatching = () => Effect.runPromise(findsNothingToLoadWhenEvery);

describe("AgentSession MCP integration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "activates tool_search for deferred MCP tools and keeps loaded tools declared on the branch",
    activatesToolSearchForDeferredMcpTools,
  );

  it(
    "finds nothing to load when every matching tool is already declared",
    findsNothingToLoadWhenEveryMatching,
  );
});
