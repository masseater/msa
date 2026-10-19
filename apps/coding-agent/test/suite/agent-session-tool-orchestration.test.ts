import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
  type TranscriptContext,
} from "@msa/ai";
import type { ToolResultMessage } from "@msa/ai/compat";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import { createToolSearchExtension } from "../../src/extensions/tool-search/index.ts";
import { createHarness, type Harness } from "./harness.ts";

function orchestratorExtension(msa: ExtensionAPI): void {
  msa.registerTool({
    name: "echo",
    label: "echo",
    description: "Echo text.",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_id, { text }) =>
      Promise.resolve({
        content: [{ type: "text", text: `echo: ${text}` }],
        details: {},
      }),
  });
  msa.registerTool({
    name: "helper",
    label: "helper",
    description: "Only reachable from other tools.",
    parameters: Type.Object({}),
    exposure: "codemode",
    execute: () => Promise.resolve({ content: [{ type: "text", text: "helped" }], details: {} }),
  });
  msa.registerTool({
    name: "run_tools",
    label: "run_tools",
    description: "Runs tools.",
    parameters: Type.Object({}),
    exposure: "model-only",
    prepareLoadout: (loadout) => ({
      descriptions: {
        run_tools: `Runs tools: ${loadout.callable.map((tool) => tool.name).join(", ")}`,
        echo: "Echo text (also callable from run_tools).",
      },
      hiddenDeclarations: ["echo"],
    }),
    execute: (_id, _params, _signal, _onUpdate, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const helper = yield* Effect.promise(() => ctx.executeTool("helper", {}));
          const echo = yield* Effect.promise(() => ctx.executeTool("echo", { text: "hi" }));
          const self = yield* Effect.promise(() => ctx.executeTool("run_tools", {}));
          const text = [helper, echo, self]
            .map((outcome) => (outcome.result.content[0] as { text: string }).text)
            .join(" | ");
          return { content: [{ type: "text", text }], details: {} };
        }),
      ),
  });
}

const harnesses: Harness[] = [];

const supportsToolsThatCallOtherTools = Effect.gen(function* () {
  const toolCalls: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      initialActiveToolNames: [],
      extensionFactories: [
        orchestratorExtension,
        (msa) => {
          msa.on("tool_call", (event) => {
            toolCalls.push(`${event.toolName}:${event.parentToolCallId ?? "top"}`);
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  yield* Effect.promise(() => harness.session.bindExtensions({}));

  expect(harness.session.getActiveToolNames()).toEqual(["echo", "run_tools"]);
  expect(harness.session.getCallableToolNames()).toEqual(["echo", "helper"]);
  const find = (name: string) =>
    harness.session.agent.state.tools.find((tool) => tool.name === name);
  expect(find("run_tools")?.description).toBe("Runs tools: echo, helper");
  expect(find("echo")?.description).toBe("Echo text (also callable from run_tools).");

  const requestTools: string[][] = [];
  harness.setResponses([
    (context: TranscriptContext) => {
      requestTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
      return fauxAssistantMessage([fauxToolCall("run_tools", {})], { stopReason: "toolUse" });
    },
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("go"));

  expect(requestTools[0]).toEqual(["run_tools"]);
  const result = harness.session.messages.find(
    (message): message is ToolResultMessage => message.role === "toolResult",
  );
  if (result === undefined) throw new Error("No tool result");
  expect(result.content).toEqual([
    { type: "text", text: "helped | echo: hi | Tool run_tools not found" },
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
  expect(plain.session.getAllTools().map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["codemode", "tool_search"]),
  );
  expect(plain.session.getActiveToolNames()).toEqual([
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
  expect(allowed.session.getActiveToolNames()).toEqual(["read", "codemode"]);
  const initial = yield* Effect.promise(() =>
    createHarness({
      initialActiveToolNames: ["tool_search"],
      extensionFactories,
    }),
  );
  harnesses.push(initial);
  expect(initial.session.getActiveToolNames()).toEqual(["tool_search"]);
});

const leavesResultsWithoutNestedCallsUnchanged = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      initialActiveToolNames: [],
      extensionFactories: [orchestratorExtension],
    }),
  );
  harnesses.push(harness);
  yield* Effect.promise(() => harness.session.bindExtensions({}));
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "x" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("go"));
  const result = harness.session.messages.find((message) => message.role === "toolResult");
  expect(result && "nestedCalls" in result).toBe(false);
});

describe("AgentSession tool orchestration", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it("supports tools that call other tools under any name through the extension API", () =>
    Effect.runPromise(supportsToolsThatCallOtherTools));
  it("registers codemode and tool_search inactive until they are named", () =>
    Effect.runPromise(registersCodemodeAndToolSearchInactive));
  it("leaves results without nested calls unchanged", () =>
    Effect.runPromise(leavesResultsWithoutNestedCallsUnchanged));
});
