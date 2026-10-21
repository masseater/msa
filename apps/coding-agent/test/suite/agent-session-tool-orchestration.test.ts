import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type extensionsTypesTypes from "../../src/core/extensions/types.types.ts";
import extension from "../../src/extensions/codemode/extension.ts";
import extensionModule from "../../src/extensions/tool-search/extension.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createCodemodeExtension } = extension;
const { createToolSearchExtension } = extensionModule;

const { fauxAssistantMessage, fauxToolCall, getCurrentTools } = ai;

const { createHarness } = harnessModule;

function orchestratorExtension(msa: extensionsTypesTypes.ExtensionAPI): void {
  msa.registerTool({
    description: "Echo text.",
    execute: (_id, { text }) =>
      Promise.resolve({
        content: [{ text: `echo: ${text}`, type: "text" }],
        details: {},
      }),
    label: "echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  });
  msa.registerTool({
    description: "Only reachable from other tools.",
    execute: () => Promise.resolve({ content: [{ text: "helped", type: "text" }], details: {} }),
    exposure: "codemode",
    label: "helper",
    name: "helper",
    parameters: Type.Object({}),
  });
  msa.registerTool({
    description: "Runs tools.",
    execute: (_id, _params, _signal, _onUpdate, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const helper = yield* Effect.promise(() => ctx.executeTool("helper", {}));
          const echo = yield* Effect.promise(() => ctx.executeTool("echo", { text: "hi" }));
          const self = yield* Effect.promise(() => ctx.executeTool("run_tools", {}));
          const text = [helper, echo, self]
            .map((outcome) => (outcome.result.content[0] as { text: string }).text)
            .join(" | ");
          return { content: [{ text, type: "text" }], details: {} };
        }),
      ),
    exposure: "model-only",
    label: "run_tools",
    name: "run_tools",
    parameters: Type.Object({}),
    prepareLoadout: (loadout) => ({
      descriptions: {
        echo: "Echo text (also callable from run_tools).",
        run_tools: `Runs tools: ${loadout.callable.map((tool) => tool.name).join(", ")}`,
      },
      hiddenDeclarations: ["echo"],
    }),
  });
}

const harnesses: harnessTypes.Harness[] = [];

const supportsToolsThatCallOtherToolsSetup = () =>
  Effect.gen(function* () {
    const toolCalls: string[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          orchestratorExtension,
          (msa) => {
            msa.on("tool_call", (event) => {
              toolCalls.push(`${event.toolName}:${event.parentToolCallId ?? "top"}`);
            });
          },
        ],
        initialActiveToolNames: [],
      }),
    );
    return { harness, toolCalls };
  });

const supportsToolsThatCallOtherTools = Effect.gen(function* () {
  const { harness, toolCalls } = yield* supportsToolsThatCallOtherToolsSetup();
  harnesses.push(harness);
  yield* Effect.promise(() => harness.session.extensions.binding.bindExtensions({}));

  expect(harness.session.tools.loadout.getActiveToolNames()).toEqual(["echo", "run_tools"]);
  expect(harness.session.tools.loadout.getCallableToolNames()).toEqual(["echo", "helper"]);
  const find = (name: string) =>
    harness.session.agent.state.tools.find((tool) => tool.name === name);
  expect(find("run_tools")?.description).toBe("Runs tools: echo, helper");
  expect(find("echo")?.description).toBe("Echo text (also callable from run_tools).");

  const requestTools: string[][] = [];
  harness.setResponses([
    (context: aiTypes.TranscriptContext) => {
      requestTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
      return fauxAssistantMessage([fauxToolCall("run_tools", {})], { stopReason: "toolUse" });
    },
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  expect(requestTools[0]).toEqual(["run_tools"]);
  const result = harness.session.messages.find(
    (message): message is aiTypes.ToolResultMessage => message.role === "toolResult",
  );
  if (result === undefined) throw new Error("No tool result");
  expect(result.content).toEqual([
    { text: "helped | echo: hi | Tool run_tools not found", type: "text" },
  ]);
  const parent = result.toolCallId;
  expect(toolCalls).toEqual(["run_tools:top", `helper:${parent}`, `echo:${parent}`]);
  expect(result.nestedCalls?.calls.map((call) => [call.id, call.name, call.status])).toEqual([
    [`${parent}/1`, "helper", "ok"],
    [`${parent}/2`, "echo", "ok"],
    [`${parent}/3`, "run_tools", "error"],
  ]);

  const persisted = harness.sessionManager
    .getBranch()
    .find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  expect(persisted?.type === "message" && persisted.message).toMatchObject({
    nestedCalls: result.nestedCalls,
  });
});

const registersCodemodeAndToolSearchInactive = Effect.gen(function* () {
  const extensionFactories = [createCodemodeExtension(), createToolSearchExtension()];
  const plain = yield* Effect.promise(() => createHarness({ extensionFactories }));
  harnesses.push(plain);
  expect(plain.session.tools.registry.getAllTools().map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["codemode", "tool_search"]),
  );
  expect(plain.session.tools.loadout.getActiveToolNames()).toEqual([
    "read",
    "bash",
    "edit",
    "write",
    "memory",
    "pr_watch",
    "model_policy",
    "model_upgrade",
  ]);

  const allowed = yield* Effect.promise(() =>
    createHarness({
      allowedToolNames: ["read", "codemode"],
      extensionFactories,
    }),
  );
  harnesses.push(allowed);
  expect(allowed.session.tools.loadout.getActiveToolNames()).toEqual(["read", "codemode"]);
  const initial = yield* Effect.promise(() =>
    createHarness({
      extensionFactories,
      initialActiveToolNames: ["tool_search"],
    }),
  );
  harnesses.push(initial);
  expect(initial.session.tools.loadout.getActiveToolNames()).toEqual(["tool_search"]);
});

const leavesResultsWithoutNestedCallsUnchanged = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [orchestratorExtension],
      initialActiveToolNames: [],
    }),
  );
  harnesses.push(harness);
  yield* Effect.promise(() => harness.session.extensions.binding.bindExtensions({}));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "x" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));
  const result = harness.session.messages.find((message) => message.role === "toolResult");
  expect(result && "nestedCalls" in result).toBe(false);
});

const supportsToolsThatCallOtherToolsUnder = () =>
  Effect.runPromise(supportsToolsThatCallOtherTools);

const registersCodemodeAndToolSearchInactiveUntil = () =>
  Effect.runPromise(registersCodemodeAndToolSearchInactive);

const leavesResultsWithoutNestedCallsUnchanged2 = () =>
  Effect.runPromise(leavesResultsWithoutNestedCallsUnchanged);

describe("AgentSession tool orchestration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it(
    "supports tools that call other tools under any name through the extension API",
    supportsToolsThatCallOtherToolsUnder,
  );
  it(
    "registers codemode and tool_search inactive until they are named",
    registersCodemodeAndToolSearchInactiveUntil,
  );
  it("leaves results without nested calls unchanged", leavesResultsWithoutNestedCallsUnchanged2);
});
