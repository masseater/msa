import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses4, loadDocsSearch, setup4 } = agentSessionMcpSupport;

const { getMessageText, getToolResult: toolResult } = harnessModule;

const declaresToolsToolSearchLoadedAgain = Effect.gen(function* () {
  const first = yield* Effect.promise(() => setup4());
  yield* Effect.promise(() => loadDocsSearch(first.harness));

  const second = yield* Effect.promise(() => setup4(first.harness.sessionManager));
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(second.harness.session.getActiveToolNames()).toContain("mcp__docs__search"),
    ),
  );
  second.harness.setResponses([
    fauxAssistantMessage([fauxToolCall("mcp__docs__search", { query: "again" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => second.harness.session.prompt("use it"));

  expect(getMessageText(toolResult(second.harness, "mcp__docs__search"))).toBe(
    "again guide\nagain faq",
  );
  const removals = second.harness.session.messages.filter(
    (message) => message.role === "system" && (message.toolsRemoved ?? []).length > 0,
  );
  expect(removals).toEqual([]);
});

const declaresToolsToolSearchLoadedAgainOn = () =>
  Effect.runPromise(declaresToolsToolSearchLoadedAgain);

describe("AgentSession MCP tools after resume and reload", () => {
  afterEach(() => {
    while (harnesses4.length > 0) harnesses4.pop()?.cleanup();
  });

  it(
    "declares tools tool_search loaded again on resume once their server connects",
    declaresToolsToolSearchLoadedAgainOn,
  );
});
