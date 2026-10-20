import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import toolModule from "../../src/extensions/tool-search/tool.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { TOOL_SEARCH_DESCRIPTION } = toolModule;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { declaredToolNames, harnesses, nestedToolNames, serversSection, setup } =
  agentSessionMcpSupport;

const { getMessageText, getToolResult: toolResult } = harnessModule;

const { fromJsonText } = testing;

const listsAndReadsResourcesWithCodex = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() =>
    setup("direct", undefined, { resources: true }),
  );
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("list_mcp_resources", {}),
        fauxToolCall("list_mcp_resource_templates", { server: "docs" }),
        fauxToolCall("read_mcp_resource", { server: "docs", uri: "docs://pages/setup" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage([fauxToolCall("read_mcp_resource", { server: "nope", uri: "docs://x" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("read"));
  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual(
    expect.arrayContaining([
      "list_mcp_resources",
      "list_mcp_resource_templates",
      "read_mcp_resource",
    ]),
  );
  expect(yield* fromJsonText(getMessageText(toolResult(harness, "list_mcp_resources")))).toEqual({
    resources: [{ mimeType: "text/markdown", name: "intro", server: "docs", uri: "docs://intro" }],
  });
  return yield* listsAndReadsResourcesWithCodexStep1(harness, calls);
});

const listsAndReadsResourcesWithCodexStep1 = (harness: harnessTypes.Harness, calls: string[]) =>
  Effect.gen(function* () {
    expect(
      yield* fromJsonText(getMessageText(toolResult(harness, "list_mcp_resource_templates"))),
    ).toEqual({
      resourceTemplates: [{ name: "page", server: "docs", uriTemplate: "docs://pages/{slug}" }],
      server: "docs",
    });
    const results = harness.session.messages.filter(
      (message): message is compatTypes.ToolResultMessage =>
        message.role === "toolResult" && message.toolName === "read_mcp_resource",
    );
    expect(getMessageText(results[0])).toBe("# docs://pages/setup");
    expect(results[1]?.isError).toBe(true);
    expect(getMessageText(results[1])).toBe(
      'MCP server "nope" has no resources. Servers with resources: docs',
    );
    expect(calls).toEqual(["read:docs://pages/setup"]);
    const annotations = harness.session.tools.registry
      .getAllTools()
      .find((tool) => tool.name === "read_mcp_resource");
    expect(annotations?.annotations).toEqual({ readOnlyHint: true });
  });

const makesTheResourceToolsCallableFrom = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() =>
    setup("codemode", undefined, { resources: true }),
  );
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `const listed = await tools.list_mcp_resources({ server: "docs" });
const read = await tools.read_mcp_resource({ server: "docs", uri: listed.resources[0].uri });
return { uris: listed.resources.map((r) => r.uri), text: read.contents[0].text };`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("read"));

  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual(["codemode"]);
  expect(
    yield* fromJsonText(getMessageText(toolResult(harness, "codemode")).split("\n").at(-1) ?? ""),
  ).toEqual({
    text: "# docs://intro",
    uris: ["docs://intro"],
  });
  expect(calls).toEqual(["read:docs://intro"]);
});

const appliesPerToolExposureOverrides = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("hidden", undefined, {
      toolExposure: { "s*": "codemode", search: "direct" },
    }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(declaredToolNames(harness)).toEqual(["codemode", "mcp__docs__search"]);
  expect(nestedToolNames(harness)).toEqual(["mcp__docs__search", "mcp__docs__shot"]);
  const codemode = harness.session.agent.state.tools.find((tool) => tool.name === "codemode");
  expect(codemode?.description).not.toContain("mcp__docs__shot");
  expect(codemode?.description).not.toContain("mcp__docs__fail");
});

const describesTheServerWithItsConfigured = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, {
      builtInTools: ["tool_search"],
      description: "Search the product docs",
      instructions: "Always search before reading.",
    }),
  );
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `const docs = await describeNamespace("mcp__docs");
const aliases = await Promise.all(["docs", "mcp__docs"].map((name) => describeNamespace(name)));
return { docs, sameForAliases: aliases.every((alias) => JSON.stringify(alias) === JSON.stringify(docs)), none: await describeNamespace("mcp__nope") };`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const description = (name: string) =>
    harness.session.agent.state.tools.find((tool) => tool.name === name)?.description ?? "";
  expect(description("codemode")).not.toContain("mcp__docs");
  expect(description("tool_search")).toBe(TOOL_SEARCH_DESCRIPTION);
  for (const name of ["codemode", "tool_search"])
    expect(description(name)).not.toContain("Always search");
  expect(
    yield* fromJsonText(getMessageText(toolResult(harness, "codemode")).split("\n").at(-1) ?? ""),
  ).toEqual({
    docs: {
      description: "Search the product docs",
      instructions: "Always search before reading.",
      name: "mcp__docs",
      tools: ["mcp__docs__search", "mcp__docs__fail", "mcp__docs__shot"],
    },
    sameForAliases: true,
  });

  expect(serversSection(harness)).toContain("- mcp__docs (codemode): Search the product docs");
});

const listsServersByTheFirstLine = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("deferred", undefined, {
      instructions: "Docs search.\nLong guidance.",
    }),
  );
  harness.setResponses([fauxAssistantMessage("done")]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const section = serversSection(harness);
  expect(section).toContain("- mcp__docs (tool_search): Docs search.\n");
  expect(section).not.toContain("Long guidance");
});

const doesNotActivateCodemodeWhenAutoenablecodemode = Effect.gen(function* () {
  const { harness, notifications } = yield* Effect.promise(() =>
    setup("codemode", undefined, {
      autoEnableCodemode: false,
    }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual([]);
  expect(nestedToolNames(harness)).toContain("mcp__docs__search");
  expect(notifications).toEqual([
    "MCP tools are only reachable from the codemode or tool_search tool, but neither is active (autoEnableCodemode is false); they cannot be called.",
  ]);
});

const treatsCodemodeMcpToolsAsReachable = Effect.gen(function* () {
  const { harness, notifications } = yield* Effect.promise(() =>
    setup("codemode", undefined, {
      autoEnableCodemode: false,
      builtInTools: ["tool_search"],
    }),
  );
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { limit: 1, query: "search the docs" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxToolCall("mcp__docs__search", { query: "loaded" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual([
    "tool_search",
    "mcp__docs__search",
  ]);
  expect(getMessageText(toolResult(harness, "mcp__docs__search"))).toBe("loaded guide\nloaded faq");
  expect(notifications).toEqual([]);
});

const reachesDeferredMcpToolsThroughCodemode = Effect.gen(function* () {
  const { harness, notifications } = yield* Effect.promise(() =>
    setup("deferred", undefined, {
      builtInTools: ["codemode"],
      withoutToolSearch: true,
    }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual(["codemode"]);
  expect(nestedToolNames(harness)).toContain("mcp__docs__search");
  expect(notifications).toEqual([]);
});

const listsAndReadsResourcesWithCodexS = () => Effect.runPromise(listsAndReadsResourcesWithCodex);

const makesTheResourceToolsCallableFromCodemode = () =>
  Effect.runPromise(makesTheResourceToolsCallableFrom);

const appliesPerToolExposureOverrides2 = () => Effect.runPromise(appliesPerToolExposureOverrides);

const describesTheServerWithItsConfiguredDescription = () =>
  Effect.runPromise(describesTheServerWithItsConfigured);

const listsServersByTheFirstLineOf = () => Effect.runPromise(listsServersByTheFirstLine);

const doesNotActivateCodemodeWhenAutoenablecodemodeIs = () =>
  Effect.runPromise(doesNotActivateCodemodeWhenAutoenablecodemode);

const treatsCodemodeMcpToolsAsReachableThrough = () =>
  Effect.runPromise(treatsCodemodeMcpToolsAsReachable);

const reachesDeferredMcpToolsThroughCodemodeWhen = () =>
  Effect.runPromise(reachesDeferredMcpToolsThroughCodemode);

describe("AgentSession MCP integration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("lists and reads resources with Codex's resource tools", listsAndReadsResourcesWithCodexS);

  it(
    "makes the resource tools callable from codemode for codemode servers",
    makesTheResourceToolsCallableFromCodemode,
  );

  it("applies per-tool exposure overrides", appliesPerToolExposureOverrides2);

  it(
    "describes the server with its configured description and returns its instructions to scripts",
    describesTheServerWithItsConfiguredDescription,
  );

  it(
    "lists servers by the first line of their instructions without a configured description",
    listsServersByTheFirstLineOf,
  );

  it(
    "does not activate codemode when autoEnableCodemode is false",
    doesNotActivateCodemodeWhenAutoenablecodemodeIs,
  );

  it(
    "treats codemode MCP tools as reachable through an active tool_search",
    treatsCodemodeMcpToolsAsReachableThrough,
  );

  it(
    "reaches deferred MCP tools through codemode when tool_search is not available",
    reachesDeferredMcpToolsThroughCodemodeWhen,
  );
});
