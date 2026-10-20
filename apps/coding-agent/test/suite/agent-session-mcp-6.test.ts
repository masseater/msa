import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../../src/core/extensions/types.types.ts";
import extension from "../../src/extensions/mcp/extension.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";

const { MCP_SERVERS_SECTION } = extension;

const { fauxAssistantMessage } = ai;

const { declaredToolNames, harnesses, setup, setupSlow } = agentSessionMcpSupport;

const { getAssistantTexts } = harnessModule;

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
    "Codemode: `tools.mcp__docs__search(args)` resolves to `{ content, isError?, structuredContent?: { hits } }`.",
  );
  expect(fail?.description).toContain(
    "Codemode: `tools.mcp__docs__fail(args)` resolves to `{ content, isError?, structuredContent? }`.",
  );
});

const activatesAnotherExtensionSCodemodeTool = Effect.gen(function* () {
  const otherExec: extensionsTypesTypes.ExtensionFactory = (msa) => {
    msa.registerTool({
      defaultActive: false,
      description: "Another extension's codemode tool.",
      execute: () => Promise.resolve({ content: [], details: undefined }),
      label: "codemode",
      name: "codemode",
      parameters: Type.Object({}),
      reachesTools: () => "all",
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
  const otherExec: extensionsTypesTypes.ExtensionFactory = (msa) => {
    msa.registerTool({
      defaultActive: false,
      description: "Another extension's codemode tool.",
      execute: () => Promise.resolve({ content: [], details: undefined }),
      label: "codemode",
      name: "codemode",
      parameters: Type.Object({}),
    });
  };
  const { harness } = yield* Effect.promise(() =>
    setup("codemode", undefined, { extensionFactories: [otherExec] }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.session.getActiveToolNames()).toEqual([]);
});

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
    (message): message is compatTypes.SystemMessage => message.role === "system",
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

const warnsWhenDeferredMcpToolsHaveNeither = () => Effect.runPromise(warnsWhenDeferredMcpToolsHave);

const tellsScriptsWhatDirectlyExposedMcpTools = () =>
  Effect.runPromise(tellsScriptsWhatDirectlyExposedMcp);

const activatesAnotherExtensionSCodemodeToolWhen = () =>
  Effect.runPromise(activatesAnotherExtensionSCodemodeTool);

const doesNotActivateAnotherExtensionSTool = () =>
  Effect.runPromise(doesNotActivateAnotherExtensionS);

const doesNotHoldTheFirstPromptFor = () => Effect.runPromise(doesNotHoldTheFirstPrompt);

const keepsTheCodemodeDescriptionUnchangedWhenThe = () =>
  Effect.runPromise(keepsTheCodemodeDescriptionUnchangedWhen);

const listsAServerBeforeItConnectsAnd = () => Effect.runPromise(listsAServerBeforeItConnects);

describe("AgentSession MCP integration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "warns when deferred MCP tools have neither tool_search nor codemode",
    warnsWhenDeferredMcpToolsHaveNeither,
  );

  it(
    "tells scripts what directly exposed MCP tools resolve to",
    tellsScriptsWhatDirectlyExposedMcpTools,
  );

  it(
    "activates another extension's codemode tool when it reaches other tools",
    activatesAnotherExtensionSCodemodeToolWhen,
  );

  it(
    "does not activate another extension's tool named codemode",
    doesNotActivateAnotherExtensionSTool,
  );

  it(
    "does not hold the first prompt for codemode servers that are still connecting",
    doesNotHoldTheFirstPromptFor,
  );

  it(
    "keeps the codemode description unchanged when the server connects",
    keepsTheCodemodeDescriptionUnchangedWhenThe,
  );

  it(
    "lists a server before it connects and appends its summary with the next prompt",
    listsAServerBeforeItConnectsAnd,
  );
});
