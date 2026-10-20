import { type AssistantMessage, Type, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type chatSupportTypes from "./chat-support.types.ts";
import testSupport from "./support.ts";

const { AgentDoc, defineTool } = durable;
const { MemoryStorage } = memory;

const { chatSetup, openChat } = testSupport;
const { awaited, toJsonText } = testSupport;
const { addTool } = testSupport;
const { context } = testSupport;

function tool(
  name: string,
  extra: Partial<durableTypes.ToolRegistration> = {},
): durableTypes.ToolRegistration {
  return defineTool({
    description: name,
    execute: () => Promise.resolve({ output: [{ text: `${name} ran`, type: "text" }] }),
    name,
    parameters: Type.Object({}),
    ...extra,
  });
}

const DONE = fauxAssistantMessage([fauxText("done")]);

function call(name: string, id = "c1"): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id })], { stopReason: "toolUse" });
}

function prober(names: readonly string[]) {
  const received = new Map<string, durableTypes.NestedToolExecutionResult>();
  const registration = defineTool({
    description: "probe",
    execute: (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const name of names)
            received.set(name, yield* awaited(api.executeTool(name, {}, callContext)));
          return {};
        }),
      ),
    name: "probe",
    parameters: Type.Object({}),
  });
  return { received, registration };
}

const offered = Effect.fn("offered")(function* (root: durableTypes.Conversation) {
  return (yield* awaited(root.agent(context))).tools.map((each) => each.name);
});

const callable = Effect.fn("callable")(function* (root: durableTypes.Conversation) {
  return (yield* awaited(root.agent(context))).callable.map((each) => each.name);
});

function setupWith(
  tools: readonly durableTypes.ToolRegistration[],
): Promise<chatSupportTypes.ChatSetup> {
  const setup = chatSetup();
  for (const each of tools) addTool(setup.registry, each);
  return Promise.resolve(setup);
}

const offersModelOnly = Effect.gen(function* () {
  const script = tool("script", { callers: ["model"] });
  const hidden = tool("hidden", { callers: ["tools"] });
  const both = tool("both");
  const probe = prober(["script", "hidden", "both"]);
  const setup = yield* awaited(setupWith([script, hidden, both, probe.registration]));
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  expect(yield* offered(root)).toEqual(["script", "both", "probe"]);
  expect(yield* callable(root)).toEqual(["hidden", "both", "probe"]);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(probe.received.get("script")?.diagnostics[0]?.code).toBe("tool_unavailable");
  expect(probe.received.get("hidden")).toMatchObject({
    isError: false,
    structuredOutput: "hidden ran",
  });
  expect(probe.received.get("both")).toMatchObject({
    isError: false,
    structuredOutput: "both ran",
  });
  yield* awaited(harness.close(context));
});

const narrowsWhatModel = Effect.gen(function* () {
  const read = tool("read");
  const bash = tool("bash");
  const probe = prober(["read", "bash"]);
  const setup = yield* awaited(setupWith([read, bash, probe.registration]));
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.configure({ modelTools: [probe.registration] }, context));
  expect(yield* offered(root)).toEqual(["probe"]);
  expect(yield* callable(root)).toEqual(["read", "bash", "probe"]);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(probe.received.get("read")?.isError).toBe(false);
  expect(probe.received.get("bash")?.isError).toBe(false);

  yield* awaited(root.configure({ modelTools: { remove: [bash] } }, context));
  expect(yield* offered(root)).toEqual(["read", "probe"]);
  expect((yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.modelTools).toEqual({
    remove: ["bash"],
  });
  yield* awaited(root.configure({ modelTools: null }, context));
  expect(yield* offered(root)).toEqual(["read", "bash", "probe"]);
  yield* awaited(harness.close(context));
});

describe("who may call a tool", () => {
  it("offers the model only tools it may call, and lets tools call only tools they may call", () =>
    Effect.runPromise(offersModelOnly));

  it("narrows what the model is offered with modelTools, leaving the rest callable by tools", () =>
    Effect.runPromise(narrowsWhatModel));
});

const neverOffersTool = Effect.gen(function* () {
  const read = tool("read");
  const bash = tool("bash");
  const probe = prober(["bash"]);
  const setup = yield* awaited(setupWith([read, bash, probe.registration]));
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    root.configure({ modelTools: [bash, probe.registration], tools: { remove: [bash] } }, context),
  );
  expect(yield* offered(root)).toEqual(["probe"]);
  expect(yield* callable(root)).toEqual(["read", "probe"]);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(probe.received.get("bash")?.diagnostics[0]?.code).toBe("tool_unavailable");
  yield* awaited(harness.close(context));
});

const answersModelIssued = Effect.gen(function* () {
  const read = tool("read");
  const bash = tool("bash");
  const setup = yield* awaited(setupWith([read, bash]));
  setup.faux.setResponses([call("bash"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.configure({ modelTools: [read] }, context));
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const entries = yield* awaited(root.entries({}, 100, undefined, context));
  const result = entries.items.find((entry) => entry.kind === "msa.tool-result");
  expect(yield* toJsonText(result?.model)).toContain("Tool bash is not available");
  yield* awaited(harness.close(context));
});

describe("who may call a tool", () => {
  it("never offers a tool that is not enabled, nor lets tools call it", () =>
    Effect.runPromise(neverOffersTool));

  it("answers a model-issued call of a tool it was not offered as unavailable", () =>
    Effect.runPromise(answersModelIssued));
});

const appliesAddToolsModelTools = Effect.gen(function* () {
  const extra = tool("extra");
  const grow = tool("grow", {
    execute: () => Promise.resolve({ control: { addTools: ["extra"] }, output: [] }),
  });
  const setup = yield* awaited(setupWith([extra, grow]));
  setup.faux.setResponses([call("grow"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.configure({ modelTools: [grow] }, context));
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect((yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.modelTools).toEqual([
    "grow",
    "extra",
  ]);
  expect(yield* offered(root)).toEqual(["grow", "extra"]);
  yield* awaited(harness.close(context));
});

describe("who may call a tool", () => {
  it("applies addTools to modelTools too, so the model is offered the added tools", () =>
    Effect.runPromise(appliesAddToolsModelTools));
});
