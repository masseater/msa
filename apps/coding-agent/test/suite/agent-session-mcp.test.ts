import * as NodeServices from "@effect/platform-node/NodeServices";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type { SystemMessage, ToolResultMessage } from "@msa/ai/compat";
import { type JsonRpcRequest, LATEST_PROTOCOL_VERSION } from "@msa/mcp";
import { createInMemoryTransportPair } from "@msa/mcp/testing";
import { fromJsonText } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ExtensionAPI, ExtensionFactory } from "../../src/core/extensions/types.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import type { McpExposure, McpServerEntry } from "../../src/extensions/mcp/config.ts";
import { createMcpExtension, MCP_SERVERS_SECTION } from "../../src/extensions/mcp/index.ts";
import { createMcpToolName } from "../../src/extensions/mcp/tools.ts";
import { createToolSearchExtension } from "../../src/extensions/tool-search/index.ts";
import { TOOL_SEARCH_DESCRIPTION } from "../../src/extensions/tool-search/tool.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import {
  createHarness,
  createTestUiContext,
  getAssistantTexts,
  getMessageText,
  type Harness,
  getToolResult as toolResult,
} from "./harness.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const SERVER_TOOLS = [
  {
    name: "search",
    description: "Search the docs.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    outputSchema: {
      type: "object",
      properties: { hits: { type: "array", items: { type: "string" } } },
      required: ["hits"],
    },
  },
  {
    name: "fail",
    description: "Always fails.",
    inputSchema: { type: "object", properties: {} },
    annotations: {
      title: "Fail",
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: "yes",
    },
  },
  {
    name: "shot",
    description: "Returns an image.",
    inputSchema: { type: "object", properties: {} },
  },
];

function createFakeServer(
  calls: string[],
  options: {
    listTools?: (() => unknown[]) | undefined;
    resources?: boolean | undefined;
    instructions?: string | undefined;
    initializeDelayMs?: number | undefined;
  } = {},
) {
  const {
    listTools = () => SERVER_TOOLS,
    resources = false,
    instructions,
    initializeDelayMs = 0,
  } = options;
  const pair = createInMemoryTransportPair();
  const respond = (request: JsonRpcRequest): unknown => {
    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {}, ...(resources ? { resources: {} } : {}) },
          serverInfo: { name: "docs", version: "1.0.0" },
          ...(instructions !== undefined && instructions !== "" ? { instructions } : {}),
        };
      case "tools/list":
        return { tools: listTools() };
      case "resources/list":
        return {
          resources: [
            { uri: "docs://intro", name: "intro", mimeType: "text/markdown", _meta: { x: 1 } },

            { uri: "ui://docs/viewer", name: "viewer", mimeType: "text/html;profile=mcp-app" },
          ],
        };
      case "resources/templates/list":
        return {
          resourceTemplates: [
            {
              uriTemplate: "docs://pages/{slug}",
              name: "page",
              icons: [{ src: "data:image/png;base64,AAAA" }],
            },
          ],
        };
      case "resources/read": {
        const { uri } = request.params as { uri: string };
        calls.push(`read:${uri}`);
        return { contents: [{ uri, mimeType: "text/markdown", text: `# ${uri}` }] };
      }
      case "tools/call": {
        const params = request.params as { name: string; arguments?: { query?: string } };
        calls.push(`${params.name}:${JSON.stringify(params.arguments ?? {})}`);
        if (params.name === "search") {
          const hits = [`${params.arguments?.query} guide`, `${params.arguments?.query} faq`];
          return {
            content: [{ type: "text", text: hits.join("\n") }],
            structuredContent: { hits },
          };
        }
        if (params.name === "shot") {
          return { content: [{ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" }] };
        }
        return { content: [{ type: "text", text: "server exploded" }], isError: true };
      }
      default:
        return {};
    }
  };
  pair.server.onMessage((message) => {
    if (!("id" in message) || !("method" in message)) return;
    const request = message as JsonRpcRequest;
    const send = () =>
      void pair.server.send({ jsonrpc: "2.0", id: request.id, result: respond(request) });
    if (request.method !== "initialize" || initializeDelayMs === 0) queueMicrotask(send);
    else if (Number.isFinite(initializeDelayMs))
      Effect.runFork(
        Effect.sleep(`${initializeDelayMs} millis`).pipe(Effect.andThen(Effect.sync(send))),
      );
  });
  return pair;
}

const harnesses: Harness[] = [];

function setup(
  exposure: McpExposure,
  listTools?: () => unknown[],
  options: {
    autoEnableCodemode?: boolean;
    builtInTools?: string[];

    allowedToolNames?: string[];
    excludedToolNames?: string[];

    sessionManager?: SessionManager;

    waitForTools?: boolean;
    extensionFactories?: ExtensionFactory[];
    toolExposure?: Record<string, McpExposure>;
    resources?: boolean;
    withoutToolSearch?: boolean;
    description?: string;
    instructions?: string;
  } = {},
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const {
        builtInTools,
        allowedToolNames,
        excludedToolNames,
        sessionManager,
        waitForTools = true,
        extensionFactories = [],
        toolExposure,
        resources,
        withoutToolSearch,
        description,
        instructions,
        ...configOptions
      } = options;
      const calls: string[] = [];
      const notifications: string[] = [];
      const servers: ReturnType<typeof createFakeServer>["server"][] = [];
      const entry: McpServerEntry = {
        name: "docs",
        config: {
          url: "http://unused.invalid",
          exposure,
          ...(toolExposure === undefined ? {} : { toolExposure }),
          ...(description !== undefined && description !== "" ? { description } : {}),
        },
        source: "test",
      };

      const harness = yield* Effect.promise(() =>
        createHarness({
          initialActiveToolNames: allowedToolNames ?? builtInTools ?? [],
          allowedToolNames,
          excludedToolNames,
          sessionManager,
          extensionFactories: [
            ...extensionFactories,
            createCodemodeExtension(),
            ...(withoutToolSearch === true ? [] : [createToolSearchExtension()]),
            createMcpExtension({
              loadConfig: () => ({ servers: [entry], errors: [], ...configOptions }),
              createTransport: () => {
                const pair = createFakeServer(calls, { listTools, resources, instructions });
                servers.push(pair.server);
                void pair.server.start();
                return pair.client;
              },
            }),
          ],
        }),
      );
      harnesses.push(harness);
      yield* Effect.promise(() =>
        harness.session.bindExtensions({
          uiContext: createTestUiContext({ notify: (message) => notifications.push(message) }),
        }),
      );

      if (waitForTools) {
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(
              harness.session.getAllTools().some((tool) => tool.name === "mcp__docs__search"),
            ).toBe(true),
          ),
        );
      }
      return { harness, calls, servers, notifications };
    }),
  );
}

function declaredToolNames(harness: Harness): string[] {
  return harness.session.messages
    .filter((message): message is SystemMessage => message.role === "system")
    .flatMap((message) => (message.toolsAdded ?? []).map((tool) => tool.name));
}

function serversSection(harness: Harness): string | null | undefined {
  let section: string | null | undefined;
  for (const message of harness.session.messages) {
    if (
      message.role === "system" &&
      message.sections !== undefined &&
      MCP_SERVERS_SECTION in message.sections
    ) {
      section = message.sections[MCP_SERVERS_SECTION];
    }
  }
  return section;
}

function nestedToolNames(harness: Harness): string[] {
  return harness.session.getCallableToolNames();
}

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
    fauxAssistantMessage([fauxToolCall("tool_search", { query: "search the docs", limit: 1 })], {
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

const exposesCodemodeOnlyMcpToolsThrough = Effect.gen(function* () {
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
    type: "image",
    data: TINY_PNG_BASE64,
    mimeType: "image/png",
  });
  expect(yield* fromJsonText((result.content[3] as { text: string }).text)).toEqual({
    hits: ["mcp guide", "mcp faq", "msa guide", "msa faq"],
    failed: true,
    failure: "server exploded",
    found: [searchName],
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

const rejectsDirectModelCallsToCodemode = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() => setup("codemode"));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall(createMcpToolName("docs", "search"), { query: "x" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("go"));

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

  yield* Effect.promise(() => harness.session.prompt("go"));

  expect(declaredToolNames(harness)).toEqual([
    "mcp__docs__search",
    "mcp__docs__fail",
    "mcp__docs__shot",
  ]);
  expect(harness.session.getActiveToolNames()).not.toContain("codemode");

  const annotations = new Map(
    harness.session.getAllTools().map((tool) => [tool.name, tool.annotations]),
  );
  expect(annotations.get("mcp__docs__fail")).toEqual({
    destructiveHint: true,
    readOnlyHint: false,
  });
  expect(annotations.get("mcp__docs__search")).toBeUndefined();
  const result = toolResult(harness, "mcp__docs__search");
  expect(getMessageText(result)).toBe("direct guide\ndirect faq");
});

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
  yield* Effect.promise(() => harness.session.prompt("read"));
  expect(harness.session.getActiveToolNames()).toEqual(
    expect.arrayContaining([
      "list_mcp_resources",
      "list_mcp_resource_templates",
      "read_mcp_resource",
    ]),
  );
  expect(yield* fromJsonText(getMessageText(toolResult(harness, "list_mcp_resources")))).toEqual({
    resources: [{ server: "docs", uri: "docs://intro", name: "intro", mimeType: "text/markdown" }],
  });
  return yield* listsAndReadsResourcesWithCodexPart2(harness, calls);
});

const listsAndReadsResourcesWithCodexPart2 = (harness: Harness, calls: string[]) =>
  Effect.gen(function* () {
    expect(
      yield* fromJsonText(getMessageText(toolResult(harness, "list_mcp_resource_templates"))),
    ).toEqual({
      server: "docs",
      resourceTemplates: [{ server: "docs", uriTemplate: "docs://pages/{slug}", name: "page" }],
    });
    const results = harness.session.messages.filter(
      (message): message is ToolResultMessage =>
        message.role === "toolResult" && message.toolName === "read_mcp_resource",
    );
    expect(getMessageText(results[0])).toBe("# docs://pages/setup");
    expect(results[1]?.isError).toBe(true);
    expect(getMessageText(results[1])).toBe(
      'MCP server "nope" has no resources. Servers with resources: docs',
    );
    expect(calls).toEqual(["read:docs://pages/setup"]);
    const annotations = harness.session
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

  yield* Effect.promise(() => harness.session.prompt("read"));

  expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
  expect(
    yield* fromJsonText(getMessageText(toolResult(harness, "codemode")).split("\n").at(-1) ?? ""),
  ).toEqual({
    uris: ["docs://intro"],
    text: "# docs://intro",
  });
  expect(calls).toEqual(["read:docs://intro"]);
});

const appliesPerToolExposureOverrides = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("hidden", undefined, {
      toolExposure: { search: "direct", "s*": "codemode" },
    }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(declaredToolNames(harness)).toEqual(["codemode", "mcp__docs__search"]);
  expect(nestedToolNames(harness)).toEqual(["mcp__docs__search", "mcp__docs__shot"]);
  const codemode = harness.session.agent.state.tools.find((tool) => tool.name === "codemode");
  expect(codemode?.description).not.toContain("mcp__docs__shot");
  expect(codemode?.description).not.toContain("mcp__docs__fail");
});

const describesTheServerWithItsConfigured = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, {
      description: "Search the product docs",
      instructions: "Always search before reading.",
      builtInTools: ["tool_search"],
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

  yield* Effect.promise(() => harness.session.prompt("go"));

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
      name: "mcp__docs",
      description: "Search the product docs",
      instructions: "Always search before reading.",
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

  yield* Effect.promise(() => harness.session.prompt("go"));

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
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.session.getActiveToolNames()).toEqual([]);
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
    fauxAssistantMessage([fauxToolCall("tool_search", { query: "search the docs", limit: 1 })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxToolCall("mcp__docs__search", { query: "loaded" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("go"));

  expect(harness.session.getActiveToolNames()).toEqual(["tool_search", "mcp__docs__search"]);
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
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
  expect(nestedToolNames(harness)).toContain("mcp__docs__search");
  expect(notifications).toEqual([]);
});

const warnsWhenDeferredMcpToolsHave = Effect.gen(function* () {
  const { harness, notifications } = yield* Effect.promise(() =>
    setup("deferred", undefined, {
      withoutToolSearch: true,
    }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.session.getActiveToolNames()).toEqual([]);
  expect(notifications).toEqual([
    "MCP tools are only reachable from the codemode or tool_search tool, but neither is active; they cannot be called.",
  ]);
});

const tellsScriptsWhatDirectlyExposedMcp = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setup("direct"));
  harness.session.setActiveToolsByName([...harness.session.getActiveToolNames(), "codemode"]);
  const search = harness.session.agent.state.tools.find(
    (tool) => tool.name === "mcp__docs__search",
  );
  const fail = harness.session.agent.state.tools.find((tool) => tool.name === "mcp__docs__fail");
  expect(search?.description).toContain(
    "Codemode: `tools.mcp__docs__search(args)` resolves to `{ content, structuredContent?: { hits }, isError? }`.",
  );
  expect(fail?.description).toContain(
    "Codemode: `tools.mcp__docs__fail(args)` resolves to `{ content, structuredContent?, isError? }`.",
  );
});

const activatesAnotherExtensionSCodemodeTool = Effect.gen(function* () {
  const otherExec: ExtensionFactory = (msa) => {
    msa.registerTool({
      name: "codemode",
      label: "codemode",
      description: "Another extension's codemode tool.",
      parameters: Type.Object({}),
      defaultActive: false,
      reachesTools: () => "all",
      execute: () => Promise.resolve({ content: [], details: undefined }),
    });
  };
  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, { extensionFactories: [otherExec] }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.session.getActiveToolNames()).toEqual(["codemode"]);
});

const doesNotActivateAnotherExtensionS = Effect.gen(function* () {
  const otherExec: ExtensionFactory = (msa) => {
    msa.registerTool({
      name: "codemode",
      label: "codemode",
      description: "Another extension's codemode tool.",
      parameters: Type.Object({}),
      defaultActive: false,
      execute: () => Promise.resolve({ content: [], details: undefined }),
    });
  };
  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, { extensionFactories: [otherExec] }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.session.getActiveToolNames()).toEqual([]);
});

function setupSlow(
  config: {
    exposure?: McpExposure;
    toolExposure?: Record<string, McpExposure>;
    name?: string;
    instructions?: string;
  },
  initializeDelayMs: number,
  startupWaitMs?: number,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = [];
      const notifications: string[] = [];
      const { name = "slow", instructions, ...serverConfig } = config;
      const entry: McpServerEntry = {
        name,
        config: { url: "http://unused.invalid", ...serverConfig },
        source: "test",
      };
      const harness = yield* Effect.promise(() =>
        createHarness({
          initialActiveToolNames: [],
          extensionFactories: [
            createCodemodeExtension(),
            createToolSearchExtension(),
            createMcpExtension({
              loadConfig: () => ({ servers: [entry], errors: [] }),
              createTransport: () => {
                const pair = createFakeServer(calls, { initializeDelayMs, instructions });
                void pair.server.start();
                return pair.client;
              },
              ...(startupWaitMs === undefined ? {} : { startupWaitMs }),
            }),
          ],
        }),
      );
      harnesses.push(harness);
      yield* Effect.promise(() =>
        harness.session.bindExtensions({
          uiContext: createTestUiContext({ notify: (message) => notifications.push(message) }),
        }),
      );
      return { harness, calls, notifications };
    }),
  );
}

const doesNotHoldTheFirstPrompt = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({}, Number.POSITIVE_INFINITY));
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(getAssistantTexts(harness)).toEqual(["ready"]);

  expect(declaredToolNames(harness)).toEqual(["codemode"]);
});

const keepsTheCodemodeDescriptionUnchangedWhen = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({}, 20));
  const description = () =>
    harness.session.agent.state.tools.find((tool) => tool.name === "codemode")?.description;
  const before = description();
  expect(before).toBeDefined();
  yield* Effect.promise(() =>
    vi.waitFor(() => expect(harness.session.getCallableToolNames()).toContain("mcp__slow__search")),
  );
  expect(description()).toBe(before);
});

const listsAServerBeforeItConnects = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setupSlow({ instructions: "Slow docs.\nMore." }, 30),
  );
  harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);

  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() =>
    vi.waitFor(() => expect(harness.session.getCallableToolNames()).toContain("mcp__slow__search")),
  );
  yield* Effect.promise(() => harness.session.prompt("second"));

  const systemMessages = harness.session.messages.filter(
    (message): message is SystemMessage => message.role === "system",
  );

  expect(systemMessages).toHaveLength(2);
  expect(systemMessages[0]?.sections?.[MCP_SERVERS_SECTION]).toContain("- mcp__slow (codemode)\n");
  expect(systemMessages[1]?.sections).toEqual({
    [MCP_SERVERS_SECTION]: expect.stringContaining("- mcp__slow (codemode): Slow docs."),
  });
  const summaryMessage = systemMessages[1];
  if (summaryMessage === undefined) throw new Error("expected the summary system message");
  expect(harness.session.messages.indexOf(summaryMessage)).toBeGreaterThan(
    harness.session.messages.findIndex((message) => message.role === "assistant"),
  );
});

const waitsForServersWithDirectTools = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() =>
    setupSlow(
      { exposure: "direct", toolExposure: { shot: "codemode" }, instructions: "Slow docs." },
      30,
    ),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(serversSection(harness)).toContain("- mcp__slow (codemode): Slow docs.");
});

const leavesServersWithOnlyDirectTools = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({ exposure: "direct" }, 0));
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

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

  yield* Effect.promise(() => harness.session.prompt("go"));

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

  yield* Effect.promise(() => harness.session.prompt("go"));

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

  yield* Effect.promise(() => harness.session.prompt("go"));

  expect(getMessageText(toolResult(harness, "codemode")).split("\n").at(-1)).toBe("2");
});

const waitsForServersBeforeToolSearch = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({ exposure: "deferred" }, 30));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { query: "search the docs", limit: 1 })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxToolCall("mcp__slow__search", { query: "late" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("go"));

  expect(getMessageText(toolResult(harness, "mcp__slow__search"))).toBe("late guide\nlate faq");
});

const holdsTheFirstPromptForServers = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setupSlow({ exposure: "direct" }, 30));
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(declaredToolNames(harness)).toContain("mcp__slow__search");
});

const holdsTheFirstPromptForServers2 = Effect.gen(function* () {
  const { harness, notifications } = yield* Effect.promise(() =>
    setupSlow({ exposure: "direct" }, Number.POSITIVE_INFINITY, 20),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(getAssistantTexts(harness)).toEqual(["ready"]);
  expect(harness.session.getActiveToolNames()).toEqual([]);
  expect(notifications).toEqual([
    "MCP servers are still connecting; their tools become available once connected.",
  ]);
});

const doesNotLetCodemodeCallItself = Effect.gen(function* () {
  const { harness } = yield* Effect.promise(() => setup("direct"));
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.prompt("start"));
  harness.session.setActiveToolsByName(["codemode", "mcp__docs__search"]);

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

  yield* Effect.promise(() => harness.session.prompt("go"));

  const result = toolResult(harness, "codemode");
  expect(result.isError).toBe(false);
  expect(yield* fromJsonText((result.content[1] as { text: string }).text)).toEqual({
    name: "mcp__docs__search",
    sameAsAllTools: true,
    none: 0,
    declared: true,
    missing: true,
    hits: ["found guide", "found faq"],
  });
  expect(calls).toEqual(['search:{"query":"found"}']);
});

const activatesToolSearchForDeferredMcp = Effect.gen(function* () {
  const { harness, calls } = yield* Effect.promise(() => setup("deferred"));
  const searchName = createMcpToolName("docs", "search");
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { query: "search the docs", limit: 1 })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxToolCall(searchName, { query: "loaded" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("find a docs tool"));
  expect(harness.session.getActiveToolNames()).toEqual(["tool_search", searchName]);
  const toolSearch = harness.session.agent.state.tools.find((tool) => tool.name === "tool_search");
  expect(toolSearch?.description).toBe(TOOL_SEARCH_DESCRIPTION);
  const search = toolResult(harness, "tool_search");
  expect(getMessageText(search)).toBe(
    `Loaded 1 tool. They are available from your next call:\n- ${searchName}: Search the docs.`,
  );
  const loadMessages = harness.session.messages.filter(
    (message): message is SystemMessage =>
      message.role === "system" &&
      (message.toolsAdded ?? []).some((tool) => tool.name === searchName),
  );
  expect(loadMessages).toHaveLength(1);
  expect(loadMessages[0]?.toolsAdded?.map((tool) => tool.name)).toEqual([searchName]);
  expect(getMessageText(toolResult(harness, searchName))).toBe("loaded guide\nloaded faq");
  expect(calls).toEqual(['search:{"query":"loaded"}']);
  return yield* activatesToolSearchForDeferredMcpPart2(harness, searchName);
});

const activatesToolSearchForDeferredMcpPart2 = (harness: Harness, searchName: string) =>
  Effect.gen(function* () {
    const branch = harness.sessionManager.getBranch();
    const firstUser = branch.find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );
    const last = branch.at(-1);
    if (firstUser === undefined || last === undefined) throw new Error("Missing entries");
    yield* Effect.promise(() => harness.session.navigateTree(firstUser.id));
    expect(harness.session.getActiveToolNames()).not.toContain(searchName);
    yield* Effect.promise(() => harness.session.navigateTree(last.id));
    expect(harness.session.getActiveToolNames()).toContain(searchName);
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
  yield* Effect.promise(() => harness.session.prompt("go"));
  expect(getMessageText(toolResult(harness, "tool_search"))).toBe("No matching tools found.");
});

describe("AgentSession MCP integration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it("keeps MCP tools when --tools names no MCP tool", () =>
    Effect.runPromise(keepsMcpToolsWhenToolsNames));
  it("removes MCP tools with --no-tools", () => Effect.runPromise(removesMcpToolsWithNoTools));
  it("does not declare unnamed MCP tools restored from the transcript", () =>
    Effect.runPromise(doesNotDeclareUnnamedMcpTools));
  it("lets tool_search declare unnamed MCP tools when --tools names it", () =>
    Effect.runPromise(letsToolSearchDeclareUnnamedMcp));
  it("filters MCP tools by the mcp__ entries of --tools", () =>
    Effect.runPromise(filtersMcpToolsByTheMcp));
  it("removes MCP tools matching --exclude-tools patterns", () =>
    Effect.runPromise(removesMcpToolsMatchingExcludeTools));
  it("exposes codemode-only MCP tools through codemode and hides them from the model", () =>
    Effect.runPromise(exposesCodemodeOnlyMcpToolsThrough));
  it("keeps codemode-only MCP tools callable across tree navigation", () =>
    Effect.runPromise(keepsCodemodeOnlyMcpToolsCallable));
  it.each([false, true])(
    "routes tools whose names differ only in - and _ (reverse: %s)",
    (reverse) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const tools = [
            {
              name: "read-file",
              description: "dashed",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "read_file",
              description: "underscored",
              inputSchema: { type: "object", properties: {} },
            },
          ];
          if (reverse) tools.reverse();
          const { harness, calls } = yield* Effect.promise(() =>
            setup("codemode", () => [...tools, ...SERVER_TOOLS]),
          );
          const code = `for (const query of ["dashed", "underscored"]) await tools[(await searchTools(query))[0].name]({});`;
          harness.setResponses([
            fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
            fauxAssistantMessage("done"),
          ]);

          yield* Effect.promise(() => harness.session.prompt("go"));

          expect(calls).toEqual(["read-file:{}", "read_file:{}"]);
        }),
      ),
  );
  it("rejects direct model calls to codemode-only MCP tools", () =>
    Effect.runPromise(rejectsDirectModelCallsToCodemode));
  it("declares directly exposed MCP tools to the model", () =>
    Effect.runPromise(declaresDirectlyExposedMcpToolsTo));
  it.each(["direct", "codemode"] as const)(
    "withdraws and restores %s MCP tools the server changes",
    (exposure) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          let tools = SERVER_TOOLS;
          const { harness, servers } = yield* Effect.promise(() => setup(exposure, () => tools));
          harness.setResponses([fauxAssistantMessage("ready")]);
          yield* Effect.promise(() => harness.session.prompt("start"));

          const reachable = () =>
            exposure === "direct" ? harness.session.getActiveToolNames() : nestedToolNames(harness);
          const listChanged = () =>
            runPromise(
              Effect.gen(function* () {
                const [server] = servers;
                if (server === undefined) throw new Error("expected an MCP server");
                yield* Effect.promise(() =>
                  server.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }),
                );
                yield* Effect.sleep(10);
              }),
            );
          expect(reachable()).toContain("mcp__docs__fail");

          tools = SERVER_TOOLS.filter((tool) => tool.name !== "fail");
          yield* Effect.promise(() => listChanged());
          expect(reachable()).not.toContain("mcp__docs__fail");
          expect(reachable()).toContain("mcp__docs__search");
          const codemode = harness.session.agent.state.tools.find(
            (tool) => tool.name === "codemode",
          );
          expect(codemode?.description ?? "").not.toContain("mcp__docs__fail");

          tools = SERVER_TOOLS;
          yield* Effect.promise(() => listChanged());
          expect(reachable()).toContain("mcp__docs__fail");
        }),
      ),
  );
  it("lists and reads resources with Codex's resource tools", () =>
    Effect.runPromise(listsAndReadsResourcesWithCodex));
  it("makes the resource tools callable from codemode for codemode servers", () =>
    Effect.runPromise(makesTheResourceToolsCallableFrom));
  it("applies per-tool exposure overrides", () =>
    Effect.runPromise(appliesPerToolExposureOverrides));
  it("describes the server with its configured description and returns its instructions to scripts", () =>
    Effect.runPromise(describesTheServerWithItsConfigured));
  it("lists servers by the first line of their instructions without a configured description", () =>
    Effect.runPromise(listsServersByTheFirstLine));
  it("does not activate codemode when autoEnableCodemode is false", () =>
    Effect.runPromise(doesNotActivateCodemodeWhenAutoenablecodemode));
  it("treats codemode MCP tools as reachable through an active tool_search", () =>
    Effect.runPromise(treatsCodemodeMcpToolsAsReachable));
  it("reaches deferred MCP tools through codemode when tool_search is not available", () =>
    Effect.runPromise(reachesDeferredMcpToolsThroughCodemode));
  it("warns when deferred MCP tools have neither tool_search nor codemode", () =>
    Effect.runPromise(warnsWhenDeferredMcpToolsHave));
  it("tells scripts what directly exposed MCP tools resolve to", () =>
    Effect.runPromise(tellsScriptsWhatDirectlyExposedMcp));
  it("activates another extension's codemode tool when it reaches other tools", () =>
    Effect.runPromise(activatesAnotherExtensionSCodemodeTool));
  it("does not activate another extension's tool named codemode", () =>
    Effect.runPromise(doesNotActivateAnotherExtensionS));
  it("does not hold the first prompt for codemode servers that are still connecting", () =>
    Effect.runPromise(doesNotHoldTheFirstPrompt));
  it("keeps the codemode description unchanged when the server connects", () =>
    Effect.runPromise(keepsTheCodemodeDescriptionUnchangedWhen));
  it("lists a server before it connects and appends its summary with the next prompt", () =>
    Effect.runPromise(listsAServerBeforeItConnects));
  it("waits for servers with direct tools before listing the servers", () =>
    Effect.runPromise(waitsForServersWithDirectTools));
  it("leaves servers with only direct tools out of the servers section", () =>
    Effect.runPromise(leavesServersWithOnlyDirectTools));
  it("waits for the servers a codemode script names", () =>
    Effect.runPromise(waitsForTheServersACodemode));
  it("waits for servers whose script identifiers differ from their names", () =>
    Effect.runPromise(waitsForServersWhoseScriptIdentifiers));
  it("does not wait for servers a codemode script does not name", () =>
    Effect.runPromise(doesNotWaitForServersA));
  it("waits for servers before tool_search searches", () =>
    Effect.runPromise(waitsForServersBeforeToolSearch));
  it("holds the first prompt for servers with direct tools", () =>
    Effect.runPromise(holdsTheFirstPromptForServers));
  it("holds the first prompt for servers with direct tools only up to startupWaitMs", () =>
    Effect.runPromise(holdsTheFirstPromptForServers2));
  it("does not let codemode call itself or inactive direct tools", () =>
    Effect.runPromise(doesNotLetCodemodeCallItself));
  it("finds tools from scripts with searchTools() and describeTool()", () =>
    Effect.runPromise(findsToolsFromScriptsWithSearchtools));
  it("activates tool_search for deferred MCP tools and keeps loaded tools declared on the branch", () =>
    Effect.runPromise(activatesToolSearchForDeferredMcp));
  it("finds nothing to load when every matching tool is already declared", () =>
    Effect.runPromise(findsNothingToLoadWhenEvery));
});

const harnesses3: Harness[] = [];

function setup3(plugins: ExtensionFactory | ExtensionFactory[], configured: McpServerEntry[] = []) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const connected: McpServerEntry[] = [];
      const harness = yield* Effect.promise(() =>
        createHarness({
          initialActiveToolNames: [],
          extensionFactories: [
            ...(Array.isArray(plugins) ? plugins : [plugins]),
            createCodemodeExtension(),
            createMcpExtension({
              loadConfig: () => ({ servers: configured, errors: [] }),
              createTransport: (entry) => {
                connected.push(entry);
                const pair = createFakeServer([]);
                void pair.server.start();
                return pair.client;
              },
            }),
          ],
        }),
      );
      harnesses3.push(harness);

      yield* Effect.promise(() =>
        harness.session.bindExtensions({ uiContext: createTestUiContext() }),
      );
      return { harness, connected };
    }),
  );
}

const connectsServersRegisteredWhileExtensionsLoad = Effect.gen(function* () {
  const { harness, connected } = yield* Effect.promise(() =>
    setup3((msa) => {
      msa.registerMcpServer("plugin", { url: "http://plugin.invalid", exposure: "direct" });
    }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(connected.map((entry) => [entry.name, entry.scope])).toEqual([["plugin", "extension"]]);
  expect(harness.session.getActiveToolNames()).toContain("mcp__plugin__search");
});

const connectsAndDisconnectsServersRegisteredDuring = Effect.gen(function* () {
  let api: ExtensionAPI | undefined;
  const { harness, connected } = yield* Effect.promise(() =>
    setup3((msa) => {
      api = msa;
    }),
  );
  if (api === undefined) throw new Error("No extension API");
  const msa = api;

  msa.registerMcpServer("late", { url: "http://late.invalid" });
  yield* Effect.promise(() =>
    vi.waitFor(() => expect(harness.session.getCallableToolNames()).toContain("mcp__late__search")),
  );
  expect(connected.map((entry) => entry.name)).toEqual(["late"]);

  expect(harness.session.getActiveToolNames()).toContain("codemode");

  msa.unregisterMcpServer("late");
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(harness.session.getCallableToolNames()).not.toContain("mcp__late__search"),
    ),
  );
});

const rejectsNamesAnotherExtensionRegistered = Effect.gen(function* () {
  const errors: string[] = [];
  yield* Effect.promise(() =>
    setup3([
      (msa) => {
        msa.registerMcpServer("taken", { url: "http://x.invalid" });

        msa.registerMcpServer("taken", { url: "http://y.invalid" });
        msa.registerMcpServer("my-server", { url: "http://x.invalid" });
      },
      (msa) => {
        for (const name of ["taken", "my_server"]) {
          try {
            msa.registerMcpServer(name, { url: "http://z.invalid" });
          } catch (caught) {
            errors.push(String(caught));
          }
        }
      },
    ]),
  );
  expect(errors).toEqual([
    expect.stringMatching(/MCP server "taken" is already registered by extension/u),

    'Error: MCP server "my_server" conflicts with registered server "my-server"',
  ]);
});

const reportsRegisteredServersWhenNoExtension = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => msa.registerMcpServer("orphan", { url: "http://orphan.invalid" }),
      ],
    }),
  );
  harnesses3.push(harness);
  const errors: string[] = [];
  yield* Effect.promise(() =>
    harness.session.bindExtensions({ onError: (error) => errors.push(error.error) }),
  );

  expect(errors).toEqual([
    expect.stringContaining('MCP server "orphan" is registered, but no loaded extension'),
  ]);
});

describe("AgentSession MCP servers registered by extensions", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });
  it("connects servers registered while extensions load", () =>
    Effect.runPromise(connectsServersRegisteredWhileExtensionsLoad));
  it("connects and disconnects servers registered during the session", () =>
    Effect.runPromise(connectsAndDisconnectsServersRegisteredDuring));
  it.each(["my-docs", "my_docs"])("prefers the mcp.json server over a registered %s", (name) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const configured: McpServerEntry = {
          name: "my-docs",
          config: { url: "http://config.invalid" },
          source: "mcp.json",
        };
        const { connected } = yield* Effect.promise(() =>
          setup3(
            (msa) => {
              msa.registerMcpServer(name, { url: "http://plugin.invalid" });
            },
            [configured],
          ),
        );
        yield* Effect.promise(() => vi.waitFor(() => expect(connected).toEqual([configured])));
        yield* Effect.sleep(10);
        expect(connected).toEqual([configured]);
      }),
    ),
  );
  it("rejects names another extension registered", () =>
    Effect.runPromise(rejectsNamesAnotherExtensionRegistered));
  it("reports registered servers when no extension connects them", () =>
    Effect.runPromise(reportsRegisteredServersWhenNoExtension));
});

const harnesses4: Harness[] = [];

function setup4(
  sessionManager?: SessionManager,
  extensionFactories: ExtensionFactory[] = [],
  initializeDelayMs = 0,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const connected: string[] = [];
      const servers: McpServerEntry[] = [
        {
          name: "docs",
          config: { url: "http://unused.invalid", exposure: "deferred" },
          source: "test",
        },
      ];
      const factories = [
        ...extensionFactories,
        createToolSearchExtension(),
        createMcpExtension({
          loadConfig: () => ({ servers, errors: [] }),
          createTransport: (entry) => {
            connected.push(entry.name);
            const pair = createFakeServer([], { initializeDelayMs });
            void pair.server.start();
            return pair.client;
          },
        }),
      ];
      let extensions = yield* Effect.promise(() => createTestExtensionsResult(factories));
      const resourceLoader = {
        ...createTestResourceLoader(),
        getExtensions: () => extensions,
        reload: () =>
          runPromise(
            Effect.gen(function* () {
              extensions = yield* Effect.promise(() => createTestExtensionsResult(factories));
            }),
          ),
      };
      const harness = yield* Effect.promise(() =>
        createHarness({ resourceLoader, sessionManager }),
      );
      harnesses4.push(harness);

      yield* Effect.promise(() =>
        harness.session.bindExtensions({ uiContext: createTestUiContext() }),
      );
      return { harness, connected };
    }),
  );
}

function loadDocsSearch(harness: Harness) {
  return Effect.runPromise(
    Effect.gen(function* () {
      harness.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("tool_search", { query: "search the docs", limit: 1 })],
          {
            stopReason: "toolUse",
          },
        ),
        fauxAssistantMessage("loaded"),
      ]);
      yield* Effect.promise(() => harness.session.prompt("load"));
      expect(harness.session.getActiveToolNames()).toContain("mcp__docs__search");
    }),
  );
}

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

const doesNotActivateRestoredToolsThat = Effect.gen(function* () {
  const first = yield* Effect.promise(() => setup4());
  yield* Effect.promise(() => loadDocsSearch(first.harness));

  const second = yield* Effect.promise(() => setup4(first.harness.sessionManager, [], 200));
  second.harness.setResponses([fauxAssistantMessage("done")]);
  yield* Effect.promise(() => second.harness.session.prompt("go"));
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(
        second.harness.session.getAllTools().some((tool) => tool.name === "mcp__docs__search"),
      ).toBe(true),
    ),
  );

  expect(second.harness.session.getActiveToolNames()).not.toContain("mcp__docs__search");
});

const declaresToolsToolSearchLoadedAgain2 = Effect.gen(function* () {
  const { harness, connected } = yield* Effect.promise(() => setup4());
  yield* Effect.promise(() => loadDocsSearch(harness));

  yield* Effect.promise(() => harness.session.reload());

  yield* Effect.promise(() => vi.waitFor(() => expect(connected).toEqual(["docs", "docs"])));
  yield* Effect.promise(() =>
    vi.waitFor(() => expect(harness.session.getActiveToolNames()).toContain("mcp__docs__search")),
  );
});

describe("AgentSession MCP tools after resume and reload", () => {
  afterEach(() => {
    while (harnesses4.length > 0) harnesses4.pop()?.cleanup();
  });
  it("declares tools tool_search loaded again on resume once their server connects", () =>
    Effect.runPromise(declaresToolsToolSearchLoadedAgain));
  it.each([
    ["drops", ["read"], false],
    ["keeps", undefined, true],
  ] as const)(
    "%s restored tools when an extension sets the loadout before they register",
    (_, loadout, kept) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const first = yield* Effect.promise(() => setup4());
          yield* Effect.promise(() => loadDocsSearch(first.harness));

          const setLoadout: ExtensionFactory = (msa) => {
            msa.on("session_start", () =>
              msa.setActiveTools(
                loadout === undefined ? [...msa.getActiveTools(), "read"] : [...loadout],
              ),
            );
          };
          const second = yield* Effect.promise(() =>
            setup4(first.harness.sessionManager, [setLoadout]),
          );
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(
                second.harness.session
                  .getAllTools()
                  .some((tool) => tool.name === "mcp__docs__search"),
              ).toBe(true),
            ),
          );

          expect(second.harness.session.getActiveToolNames().includes("mcp__docs__search")).toBe(
            kept,
          );
        }),
      ),
  );
  it("does not activate restored tools that register after the next prompt starts", () =>
    Effect.runPromise(doesNotActivateRestoredToolsThat));
  it("declares tools tool_search loaded again after /reload", () =>
    Effect.runPromise(declaresToolsToolSearchLoadedAgain2));
});
