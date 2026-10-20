import { type FauxResponseStep, type SystemMessage } from "@msa/ai";
import { type Conversation, LiveDoc, ToolResultEntry } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import harnessToolsSupport from "./harness-tools-support.ts";
import sessionSupport from "./session-support.ts";

const { allEntries, chatSetup } = chatSupport;

type ToolExecute = Parameters<typeof harnessToolsSupport.tool>[1];
const { awaited } = effectSupport;
const { addHooks, addTool } = harnessSupport;
const { DONE, calls, resultText, results, run, tool } = harnessToolsSupport;
const { context } = sessionSupport;

const runsInputTool = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("echo", (args) =>
      Promise.resolve({
        output: [{ text: `echo ${args.text}`, type: "text" }],
      }),
    ),
  );
  const { harness, root, entries, status } = yield* run(setup, [
    calls(["echo", { text: "hi" }, "c1"]),
    DONE,
  ]);
  expect(status).toBe("done");
  expect(entries.map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
    "msa.tool-result",
    "msa.assistant",
  ]);
  const system = entries[1]!.model![0] as SystemMessage;
  expect(system.toolsAdded).toEqual([
    { description: "The echo tool", name: "echo", parameters: expect.any(Object) },
  ]);
  const [result] = results(entries);
  expect(result).toMatchObject({ isError: false, toolCallId: "c1", toolName: "echo" });
  expect(resultText(result!)).toBe("echo hi");
  expect(ToolResultEntry.is(entries[3]) && entries[3].data).toEqual({ diagnostics: [] });
  expect(entries[3]!.byTaskId).toBeDefined();
  expect(setup.faux.state.callCount).toBe(2);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("tool round", () => {
  it("runs input, tool call, tool result, and answer, and settles the input", () =>
    Effect.runPromise(runsInputTool));
});

const givesToolsHooks = Effect.gen(function* () {
  const setup = chatSetup();
  const seen: unknown[] = [];
  addTool(
    setup.registry,
    tool("echo", (_args, api) => {
      seen.push(api.models);
      return Promise.resolve({ output: [] });
    }),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: (_call, api) => {
      seen.push(api.models);
      return undefined;
    },
  });
  const { harness, status } = yield* run(setup, [calls(["echo", {}, "c1"]), DONE]);
  expect(status).toBe("done");
  expect(seen).toEqual([setup.models, setup.models]);
  expect(seen.every((models) => models === setup.models)).toBe(true);
  yield* awaited(harness.close(context));
});

describe("tool round", () => {
  it("gives tools and hooks the Harness's models", () => Effect.runPromise(givesToolsHooks));
});

const answersCallsTools = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("echo", () => Promise.resolve({ output: [] })),
  );
  const { harness, root, entries, status } = yield* run(setup, [
    calls(["ghost", {}, "c1"], ["echo", {}, "c2"]),
    DONE,
  ]);
  expect(status).toBe("done");
  const [ghost, echo] = results(entries);
  expect(ghost).toMatchObject({ isError: true, toolCallId: "c1" });
  expect(resultText(ghost!)).toBe("<harness>\n[error] Tool ghost is not available\n</harness>");
  expect(echo).toMatchObject({ isError: false, toolCallId: "c2" });
  const ghostEntry = entries.find(
    (entry) => ToolResultEntry.is(entry) && entry.model![0]!.role === "toolResult",
  );
  expect(ghostEntry?.data).toEqual({
    diagnostics: [
      { code: "tool_unavailable", message: "Tool ghost is not available", severity: "error" },
    ],
  });
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 20), context),
  );
  expect(tasks.items.filter((task) => task.kind === "msa.tool")).toHaveLength(1);
  yield* awaited(harness.close(context));
});

describe("tool round", () => {
  it("answers calls to tools the request did not offer without a task", () =>
    Effect.runPromise(answersCallsTools));
});

const answersCallTool = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const seen: string[] = [];
  addTool(
    setup.registry,
    tool("echo", () => {
      seen.push("ran");
      return Promise.resolve({ output: [] });
    }),
  );
  let root!: Conversation;
  const deactivate: FauxResponseStep = () =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(root.configure({ tools: [] }, context));
        return calls(["echo", {}, "c1"]);
      }),
    );
  const result = yield* run(setup, [deactivate, DONE], (_harness, conversation) => {
    root = conversation;

    return Promise.resolve();
  });
  expect(seen).toEqual([]);
  expect(resultText(results(result.entries)[0]!)).toBe(
    "<harness>\n[error] Tool echo is not available\n</harness>",
  );
  const systems = result.entries.filter((entry) => entry.kind === "msa.system");
  expect((systems.at(-1)!.model![0] as SystemMessage).toolsRemoved).toEqual([{ name: "echo" }]);
  yield* awaited(result.harness.close(context));
});

describe("tool round", () => {
  it("answers a call to a tool deactivated after preparation with tool_unavailable", () =>
    Effect.runPromise(answersCallTool));
});

const removesUnregisteredActive = Effect.gen(function* () {
  const setup = chatSetup();
  const echo = tool("echo", () => Promise.resolve({ output: [] }));
  const registration = addTool(setup.registry, echo);
  const first = yield* run(setup, [DONE]);
  registration.dispose();
  setup.faux.setResponses([calls(["echo", {}, "c1"]), DONE]);
  const second = yield* awaited(
    (yield* awaited(first.root.submit({ content: "again", type: "input" }, context))).wait(context),
  );
  expect(second.status).toBe("done");
  let entries = yield* allEntries(first.root);
  const removal = entries.filter((entry) => entry.kind === "msa.system").at(-1)!
    .model![0] as SystemMessage;
  expect(removal.toolsRemoved).toEqual([{ name: "echo" }]);
  expect(results(entries)[0]).toMatchObject({ isError: true });
  expect((yield* awaited(first.root.agent(context))).tools).toEqual([]);

  addTool(setup.registry, echo);
  setup.faux.setResponses([DONE]);
  yield* awaited(
    (yield* awaited(first.root.submit({ content: "back", type: "input" }, context))).wait(context),
  );
  entries = yield* allEntries(first.root);
  const addition = entries.filter((entry) => entry.kind === "msa.system").at(-1)!
    .model![0] as SystemMessage;
  expect(addition.toolsAdded?.map((declared) => declared.name)).toEqual(["echo"]);
  yield* awaited(first.harness.close(context));
});

describe("tool round", () => {
  it("removes unregistered active tools from the offer and adds them back after re-registration", () =>
    Effect.runPromise(removesUnregisteredActive));
});

const producesToolUnavailable = Effect.gen(function* () {
  const setup = chatSetup();
  let second!: ReturnType<typeof addTool>;
  addTool(
    setup.registry,
    tool(
      "first",
      () => {
        second.dispose();
        return Promise.resolve({ output: [] });
      },
      { executionMode: "sequential" },
    ),
  );
  second = addTool(
    setup.registry,
    tool("second", () => Promise.resolve({ output: [{ text: "ran", type: "text" }] })),
  );
  const { harness, entries, status } = yield* run(setup, [
    calls(["first", {}, "c1"], ["second", {}, "c2"]),
    DONE,
  ]);
  expect(status).toBe("done");
  const [, late] = results(entries);
  expect(resultText(late!)).toBe("<harness>\n[error] Tool second is not available\n</harness>");
  yield* awaited(harness.close(context));
});

describe("tool round", () => {
  it("produces tool_unavailable when the implementation is unregistered before its task runs", () =>
    Effect.runPromise(producesToolUnavailable));
});

const readsExecutionMode = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const events: string[] = [];
  const slow =
    (name: string): ToolExecute =>
    () =>
      runPromise(
        Effect.gen(function* () {
          events.push(`start ${name}`);
          setup.settings.toolExecution = "parallel";
          yield* Effect.sleep(20);
          events.push(`end ${name}`);
          return { output: [] };
        }),
      );
  addTool(setup.registry, tool("a", slow("a")));
  addTool(setup.registry, tool("b", slow("b")));
  const request: FauxResponseStep = () => {
    setup.settings.toolExecution = "sequential";
    return calls(["a", {}, "c1"], ["b", {}, "c2"]);
  };
  const { harness } = yield* run(setup, [request, DONE]);
  expect(events).toEqual(["start a", "end a", "start b", "end b"]);
  yield* awaited(harness.close(context));
});

describe("tool round", () => {
  it("reads the execution mode when a round starts and keeps it for the round", () =>
    Effect.runPromise(readsExecutionMode));
});
