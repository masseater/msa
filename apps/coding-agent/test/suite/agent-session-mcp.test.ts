import * as NodeServices from "@effect/platform-node/NodeServices";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createMcpToolName } from "../../src/extensions/mcp/tools.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";

const { TINY_PNG_BASE64, declaredToolNames, harnesses, nestedToolNames, setup } =
  agentSessionMcpSupport;

const { getToolResult: toolResult } = harnessModule;

const { fromJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);

const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const keepsMcpToolsWhenToolsNames = Effect.gen(function* () {
  for (const exposure of ["codemode", "deferred"] as const) {
    const { harness } = yield* Effect.promise(() =>
      setup(exposure, undefined, {
        allowedToolNames: ["read", "codemode"],
        resources: true,
      }),
    );
    expect(harness.session.getActiveToolNames()).toEqual(["read", "codemode"]);
    expect(nestedToolNames(harness)).toEqual(
      expect.arrayContaining([
        "mcp__docs__search",
        "mcp__docs__fail",
        "list_mcp_resources",
        "read_mcp_resource",
      ]),
    );
    expect(harness.session.getAllTools().map((tool) => tool.name)).not.toContain("bash");
  }

  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, {
      allowedToolNames: ["codemode"],
      toolExposure: { fail: "direct" },
    }),
  );
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(harness.session.getAllTools().map((tool) => tool.name)).toContain("mcp__docs__fail"),
    ),
  );
  expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
});

const removesMcpToolsWithNoTools = Effect.gen(function* () {
  const { harness, servers } = yield* Effect.promise(() =>
    setup("direct", undefined, {
      allowedToolNames: [],
      waitForTools: false,
    }),
  );
  harness.setResponses([fauxAssistantMessage("done")]);
  yield* Effect.promise(() => harness.session.prompt("go"));

  expect(servers).toHaveLength(1);
  expect(harness.session.getAllTools()).toEqual([]);
  expect(harness.session.getActiveToolNames()).toEqual([]);
});

const doesNotDeclareUnnamedMcpTools = Effect.gen(function* () {
  const first = yield* Effect.promise(() => setup("direct"));
  first.harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
  yield* Effect.promise(() => first.harness.session.prompt("first"));
  yield* Effect.promise(() => first.harness.session.prompt("second"));
  expect(declaredToolNames(first.harness)).toContain("mcp__docs__search");

  const second = yield* Effect.promise(() =>
    setup("direct", undefined, {
      allowedToolNames: ["read", "codemode"],
      sessionManager: first.harness.sessionManager,
    }),
  );
  const firstAssistant = second.harness.sessionManager
    .getBranch()
    .find((entry) => entry.type === "message" && entry.message.role === "assistant");
  if (firstAssistant === undefined) throw new Error("No assistant entry");
  yield* Effect.promise(() => second.harness.session.navigateTree(firstAssistant.id));

  expect(second.harness.session.getActiveToolNames()).toEqual([]);
  expect(second.harness.session.getAllTools().map((tool) => tool.name)).toContain(
    "mcp__docs__search",
  );
});

const letsToolSearchDeclareUnnamedMcp = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("deferred", undefined, { allowedToolNames: ["tool_search"] }),
  );
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { limit: 1, query: "search the docs" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("loaded"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("load"));

  expect(harness.session.getActiveToolNames()).toEqual(["tool_search", "mcp__docs__search"]);
});

const filtersMcpToolsByTheMcp = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, {
      allowedToolNames: ["codemode", "mcp__docs__s*"],
      resources: true,
      toolExposure: { shot: "direct" },
    }),
  );
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(harness.session.getActiveToolNames()).toEqual(["codemode", "mcp__docs__shot"]),
    ),
  );
  const registered = harness.session.getAllTools().map((tool) => tool.name);
  expect(registered).toEqual(expect.arrayContaining(["mcp__docs__search", "mcp__docs__shot"]));
  expect(registered).not.toContain("mcp__docs__fail");
  expect(registered).not.toContain("list_mcp_resources");
});

const removesMcpToolsMatchingExcludeTools = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, {
      allowedToolNames: ["codemode"],
      excludedToolNames: ["mcp__docs__f*"],
    }),
  );
  const registered = harness.session.getAllTools().map((tool) => tool.name);
  expect(registered).toContain("mcp__docs__search");
  expect(registered).not.toContain("mcp__docs__fail");
});

const exposesCodemodeOnlyMcpToolsThroughPart1 = () =>
  Effect.gen(function* () {
    const { harness, calls } = yield* Effect.promise(() => setup("codemode"));
    const searchName = createMcpToolName("docs", "search");

    harness.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("codemode", {
            code: `
							const [a, b] = await Promise.allSettled([
								tools.${searchName}({ query: "mcp" }),
								tools.${searchName}({ query: "msa" }),
							]);
							const failure = await tools.mcp__docs__fail({});
							const shot = await tools.mcp__docs__shot({});
							image(shot.content[0]);
							text(JSON.stringify({
								hits: [...a.value.structuredContent.hits, ...b.value.structuredContent.hits],
								failed: failure.isError,
								failure: failure.content[0].text,
								found: ALL_TOOLS.filter((tool) => tool.name.includes("search")).map((tool) => tool.name),
							}));
						`,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    return { calls, harness, searchName };
  });

const exposesCodemodeOnlyMcpToolsThrough = Effect.gen(function* () {
  const { calls, harness, searchName } = yield* exposesCodemodeOnlyMcpToolsThroughPart1();

  yield* Effect.promise(() => harness.session.prompt("search the docs"));

  expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
  expect(declaredToolNames(harness)).toEqual(["codemode"]);
  expect(nestedToolNames(harness)).toEqual([searchName, "mcp__docs__fail", "mcp__docs__shot"]);

  const codemode = harness.session.agent.state.tools.find((tool) => tool.name === "codemode");
  expect(codemode?.description).not.toContain("mcp__docs");
  expect(codemode?.description).not.toContain("Shared MCP Types:");

  const result = toolResult(harness, "codemode");
  expect(result.isError).toBe(false);

  const savedPath = /^\[Image saved to (\S+\.png) \(image\/png, \d+B\)\]$/u.exec(
    (result.content[1] as { text: string }).text,
  )?.[1];
  expect(savedPath).toBeDefined();
  try {
    expect(Buffer.from(yield* fs.readFile(savedPath!)).toString("base64")).toBe(TINY_PNG_BASE64);
  } finally {
    if (savedPath !== undefined && savedPath !== "") yield* fs.remove(savedPath, { force: true });
  }
  expect(result.content[2]).toEqual({
    data: TINY_PNG_BASE64,
    mimeType: "image/png",
    type: "image",
  });
  expect(yield* fromJsonText((result.content[3] as { text: string }).text)).toEqual({
    failed: true,
    failure: "server exploded",
    found: [searchName],
    hits: ["mcp guide", "mcp faq", "msa guide", "msa faq"],
  });
  expect(result.content).toHaveLength(4);
  expect(calls).toEqual(['search:{"query":"mcp"}', 'search:{"query":"msa"}', "fail:{}", "shot:{}"]);
});

const keepsCodemodeOnlyMcpToolsCallable = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setup("codemode"));
  const searchName = createMcpToolName("docs", "search");
  harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() => harness.session.prompt("second"));
  expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
  expect(nestedToolNames(harness)).toContain(searchName);

  const firstAssistant = harness.sessionManager
    .getBranch()
    .find((entry) => entry.type === "message" && entry.message.role === "assistant");
  if (firstAssistant === undefined) throw new Error("No assistant entry");
  yield* Effect.promise(() => harness.session.navigateTree(firstAssistant.id));

  expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
  expect(nestedToolNames(harness)).toContain(searchName);
});

const keepsMcpToolsWhenToolsNamesNo = () => Effect.runPromise(keepsMcpToolsWhenToolsNames);

const removesMcpToolsWithNoTools2 = () => Effect.runPromise(removesMcpToolsWithNoTools);

const doesNotDeclareUnnamedMcpToolsRestored = () =>
  Effect.runPromise(doesNotDeclareUnnamedMcpTools);

const letsToolSearchDeclareUnnamedMcpTools = () =>
  Effect.runPromise(letsToolSearchDeclareUnnamedMcp);

const filtersMcpToolsByTheMcpEntries = () => Effect.runPromise(filtersMcpToolsByTheMcp);

const removesMcpToolsMatchingExcludeToolsPatterns = () =>
  Effect.runPromise(removesMcpToolsMatchingExcludeTools);

const exposesCodemodeOnlyMcpToolsThroughCodemode = () =>
  Effect.runPromise(exposesCodemodeOnlyMcpToolsThrough);

const keepsCodemodeOnlyMcpToolsCallableAcross = () =>
  Effect.runPromise(keepsCodemodeOnlyMcpToolsCallable);

describe("AgentSession MCP integration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("keeps MCP tools when --tools names no MCP tool", keepsMcpToolsWhenToolsNamesNo);

  it("removes MCP tools with --no-tools", removesMcpToolsWithNoTools2);

  it(
    "does not declare unnamed MCP tools restored from the transcript",
    doesNotDeclareUnnamedMcpToolsRestored,
  );

  it(
    "lets tool_search declare unnamed MCP tools when --tools names it",
    letsToolSearchDeclareUnnamedMcpTools,
  );

  it("filters MCP tools by the mcp__ entries of --tools", filtersMcpToolsByTheMcpEntries);

  it(
    "removes MCP tools matching --exclude-tools patterns",
    removesMcpToolsMatchingExcludeToolsPatterns,
  );

  it(
    "exposes codemode-only MCP tools through codemode and hides them from the model",
    exposesCodemodeOnlyMcpToolsThroughCodemode,
  );

  it(
    "keeps codemode-only MCP tools callable across tree navigation",
    keepsCodemodeOnlyMcpToolsCallableAcross,
  );
});
