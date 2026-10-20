import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import tools from "../../src/extensions/mcp/tools.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";

const { createMcpToolName } = tools;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { declaredToolNames, harnesses, setup } = agentSessionMcpSupport;

const { getMessageText, getToolResult: toolResult } = harnessModule;

const rejectsDirectModelCallsToCodemode = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() => setup("codemode"));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall(createMcpToolName("docs", "search"), { query: "x" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const result = toolResult(harness, "mcp__docs__search");
  expect(result.isError).toBe(true);
  expect(getMessageText(result)).toBe("Tool mcp__docs__search not found");
  expect(calls).toEqual([]);
});

const declaresDirectlyExposedMcpToolsTo = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setup("direct"));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("mcp__docs__search", { query: "direct" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  expect(declaredToolNames(harness)).toEqual([
    "mcp__docs__search",
    "mcp__docs__fail",
    "mcp__docs__shot",
  ]);
  expect(harness.session.tools.loadout.getActiveToolNames()).not.toContain("codemode");

  const annotations = new Map(
    harness.session.tools.registry.getAllTools().map((tool) => [tool.name, tool.annotations]),
  );
  expect(annotations.get("mcp__docs__fail")).toEqual({
    destructiveHint: true,
    readOnlyHint: false,
  });
  expect(annotations.get("mcp__docs__search")).toBeUndefined();
  const result = toolResult(harness, "mcp__docs__search");
  expect(getMessageText(result)).toBe("direct guide\ndirect faq");
});

const rejectsDirectModelCallsToCodemodeOnly = () =>
  Effect.runPromise(rejectsDirectModelCallsToCodemode);

const declaresDirectlyExposedMcpToolsToThe = () =>
  Effect.runPromise(declaresDirectlyExposedMcpToolsTo);

describe("AgentSession MCP integration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "rejects direct model calls to codemode-only MCP tools",
    rejectsDirectModelCallsToCodemodeOnly,
  );

  it("declares directly exposed MCP tools to the model", declaresDirectlyExposedMcpToolsToThe);
});
