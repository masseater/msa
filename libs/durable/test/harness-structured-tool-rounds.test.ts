import { type ToolResultMessage, Type, fauxAssistantMessage, fauxText } from "@msa/ai";
import {
  type AgentEvent,
  type Harness,
  LiveDoc,
  type TaskId,
  ToolResultEntry,
  defineTool,
} from "@msa/durable";
import { GenerationTask, watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessGenerationSupport from "./harness-generation-support.ts";
import harnessStructuredEvents from "./harness-structured-events.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import support from "./support.ts";

const { invalidFinalStream } = harnessGenerationSupport;
const { blockingTool, toolCalls } = harnessStructuredEvents;
const { Node, behaviors, directories, gate, gates, log, open, outcomeOf, owned, script, state } =
  harnessStructuredSupport;
const {
  ControlledStorage,
  addHooks,
  addTask,
  addTool,
  allEntries,
  awaited,
  chatSetup,
  context,
  openChat,
  removeDir,
  settled,
  waitFor,
} = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const faultedGenerationSetupStep1 = Effect.fn("faultedGenerationSetupStep1")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const base = chatSetup();
  const models = new Proxy(base.models, {
    get(target, property) {
      if (property === "streamSimple") return invalidFinalStream;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const setup = { ...base, models };
  addTask(setup.registry, Node);
  const faulted: { opened?: Harness; reject?: TaskId } = {};
  addHooks(setup.registry, GenerationTask, {
    beforeRequest: (_request, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(
            faulted.opened!.commit(
              (tx) => tx.createTask(Node, { name: "hooked" }, owned(api.taskId)),
              callContext,
            ),
          );
          return undefined;
        }),
      ),
  });
  script("hooked", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(gate("abort.hooked").promise);
          yield* awaited(
            runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
          );
        }),
      ),
  });
  const failure = new Error("disk gone");
  return { failure, faulted, setup };
});

const faultedGenerationSetup = Effect.fn("faultedGenerationSetup")(function* () {
  const { setup, faulted, failure } = yield* faultedGenerationSetupStep1();
  class Failing extends ControlledStorage {
    override commit(
      writes: Parameters<MemoryStorage["commit"]>[0],
      ctx: Parameters<MemoryStorage["commit"]>[1],
    ) {
      const finalizes = writes.some(
        (write) =>
          write.type === "task" &&
          write.value.id === faulted.reject &&
          write.value.state.status === "terminal",
      );
      if (finalizes) {
        delete faulted.reject;
        return Promise.reject(failure);
      }
      return Promise.resolve(super.commit(writes, ctx));
    }
  }
  const storage = new Failing();
  const { harness, root } = yield* openChat(storage, setup);
  return { failure, faulted, harness, root, setup, storage };
});

const answersUnstartedCalls = Effect.gen(function* () {
  const setup = chatSetup();
  const one = blockingTool("one");
  addTool(setup.registry, one.registration);
  addTool(setup.registry, defineTool({ ...blockingTool("two").registration, name: "two" }));
  setup.faux.setResponses([toolCalls(["one", "c1"], ["two", "c2"], ["two", "c3"])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(one.started);
  expect(
    (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.tools!.map(
      (slot) => slot.taskId !== undefined,
    ),
  ).toEqual([true, false, false]);
  const generation = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId;
  yield* awaited(harness.abortTask(generation, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  const results = (yield* allEntries(root))
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
  expect(results.map((result) => result.toolCallId)).toEqual(["c1", "c2", "c3"]);
  expect(results.map((result) => result.isError)).toEqual([true, true, true]);
  expect(results[1]!.content).toEqual([
    { text: "<harness>\n[error] Tool two was aborted\n</harness>", type: "text" },
  ]);
  const tools = (yield* awaited(
    harness.commit(
      (tx) => tx.scanTasks({ conversationId: root.id, kind: "msa.tool" }, 20),
      context,
    ),
  )).items;
  expect(tools).toHaveLength(1);
  yield* awaited(harness.close(context));
});

describe("tool rounds", () => {
  it("answers the unstarted calls of an aborted sequential round with aborted results, in call order", () =>
    Effect.runPromise(answersUnstartedCalls));
});

const endsTurnGenerationStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTask(setup.registry, Node);
  addTool(
    setup.registry,
    defineTool({
      description: "Does nothing",
      execute: () => Promise.resolve({ output: [] }),
      name: "noop",
      parameters: Type.Object({}),
    }),
  );
  let opened: Harness | undefined;
  addHooks(setup.registry, GenerationTask, {
    afterTools: (_assistant, _results, api, callContext) =>
      runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              opened!.commit(
                (tx) => tx.createTask(Node, { name: "hooked" }, owned(api.taskId)),
                callContext,
              ),
            ),
          ),
        ),
      ),
  });
  setup.faux.setResponses([toolCalls(["noop", "c1"]), fauxAssistantMessage([fauxText("done")])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  opened = harness;
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const events: AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  return { events, harness, stream };
});

const endsTurnGeneration = Effect.gen(function* () {
  const { harness, stream, events } = yield* endsTurnGenerationStep1;
  const first = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: "msa.generation" }, 1), context),
  )).items[0]!;
  expect((yield* state(harness, first.id)).status).toBe("completing");
  const turns = () =>
    events.filter((event) => event.type.startsWith("turn_")).map((event) => event.type);
  yield* waitFor(() => turns().length === 4);
  expect(turns()).toEqual(["turn_start", "turn_end", "turn_start", "turn_end"]);
  open("hooked");
  expect(yield* awaited(outcomeOf(harness, first.id))).toBe("completed");
  yield* waitFor(() => turns().length === 4);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("tool rounds", () => {
  it("ends a turn at the generation's hold, before its successor's turn starts", () =>
    Effect.runPromise(endsTurnGeneration));
});

const keepsRunControlStep1 = Effect.gen(function* () {
  const { setup, faulted, failure, storage, harness, root } = yield* faultedGenerationSetup();
  faulted.opened = harness;
  const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
  yield* waitFor(
    Effect.gen(function* () {
      const generation = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))?.run?.taskId;
      return (
        generation !== undefined && (yield* state(harness, generation)).status === "completing"
      );
    }),
  );
  const generation = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId;
  expect(yield* state(harness, generation)).toMatchObject({
    outcome: { status: "faulted" },
    status: "completing",
  });
  expect(yield* settled(submission.wait(context))).toBe(false);
  expect((yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run?.taskId).toBe(
    generation,
  );
  yield* waitFor(() => log.includes("abort:hooked"));
  faulted.reject = generation;
  open("abort.hooked");
  expect(yield* awaited(harness.closed)).toEqual({ error: failure, reason: "failed" });
  yield* awaited(
    expect(submission.wait(context)).rejects.toMatchObject({
      cause: failure,
      name: "SessionFailed",
    }),
  );
  yield* awaited(harness.close(context));
  const reopened = yield* openChat(storage.reopen(), setup);
  faulted.opened = reopened.harness;
  const again = (yield* awaited(reopened.harness.submission(submission.id, context)))!;
  expect(yield* awaited(again.wait(context))).toMatchObject({
    reason: "faulted",
    status: "unanswered",
  });
  return { reopened };
});

const keepsRunControl = Effect.gen(function* () {
  const { reopened } = yield* keepsRunControlStep1;
  expect(yield* awaited(reopened.harness.snapshot(LiveDoc, reopened.root.id, context))).toEqual({});
  expect((yield* allEntries(reopened.root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.assistant",
  ]);
  yield* awaited(reopened.harness.close(context));
});

describe("tool rounds", () => {
  it("keeps run control with a faulted generation until its owned work drains, and fails the Harness on a failed final commit", () =>
    Effect.runPromise(keepsRunControl));
});
