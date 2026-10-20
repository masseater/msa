import { Type, fauxAssistantMessage, fauxText } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessStructuredEvents from "./harness-structured-events.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import support from "./support.ts";

const { LiveDoc, defineTool } = durable;
const { MemoryStorage } = memory;
const { GenerationTask } = harnessModule;

const { blockingTool, labels, listen, toolCalls } = harnessStructuredEvents;
const { Node, behaviors, directories, gates, log, open, owned } = harnessStructuredSupport;
const { addHooks, addTask, addTool, awaited, chatSetup, context, openChat, removeDir, waitFor } =
  support;

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

const endsAbortedSequential = Effect.gen(function* () {
  const setup = chatSetup();
  const one = blockingTool("one");
  addTool(setup.registry, one.registration);
  addTool(setup.registry, defineTool({ ...blockingTool("two").registration, name: "two" }));
  setup.faux.setResponses([toolCalls(["one", "c1"], ["two", "c2"], ["two", "c3"])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(one.started);
  yield* awaited(
    harness.abortTask(
      (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId,
      context,
    ),
  );
  yield* awaited(submission.wait(context));
  yield* waitFor(() => labels(events).includes("result:c3"));
  expect(labels(events).filter((label) => !label.startsWith("message:"))).toEqual([
    "end:c1:true",
    "result:c1",
    "end:c2:true",
    "result:c2",
    "end:c3:true",
    "result:c3",
  ]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("tool rounds and events", () => {
  it("ends an aborted sequential round's unstarted calls with their result entries, right before them", () =>
    Effect.runPromise(endsAbortedSequential));
});

const emitsOneTurnStep1 = Effect.gen(function* () {
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
  let opened: durableTypes.Harness | undefined;
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
  const early = yield* listen(harness, root);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const late = yield* listen(harness, root);
  open("hooked");
  const [first] = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: "msa.generation" }, 1), context),
  )).items;
  yield* awaited(harness.waitForTask(first!.id, context));
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  return { early, harness, late };
});

const emitsOneTurn = Effect.gen(function* () {
  const { harness, early, late } = yield* emitsOneTurnStep1;
  yield* waitFor(() => late.events.some((event) => event.type === "entry_appended"));
  const turns = (events: readonly durableTypes.AgentEvent[]) =>
    events.filter((event) => event.type === "turn_end").length;
  expect(turns(early.events)).toBe(2);
  expect(turns(late.events)).toBe(0);
  yield* awaited(early.stream.stop());
  yield* awaited(late.stream.stop());
  yield* awaited(harness.close(context));
});

describe("tool rounds and events", () => {
  it("emits one turn_end per generation, also for a stream attached while it holds", () =>
    Effect.runPromise(emitsOneTurn));
});
