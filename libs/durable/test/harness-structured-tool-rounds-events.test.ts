import { Type, fauxAssistantMessage, fauxText } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessStructuredEvents from "./harness-structured-events.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import support from "./support.ts";

const { LiveDoc, defineTool } = durable;
const { MemoryStorage } = memory;

const { labels, listen, toolCalls } = harnessStructuredEvents;
const {
  Node,
  OWN_CONVERSATION,
  behaviors,
  directories,
  gate,
  gates,
  log,
  open,
  outcomeOf,
  owned,
  script,
  state,
} = harnessStructuredSupport;
const { addTask, addTool, awaited, chatSetup, context, openChat, removeDir, settled, waitFor } =
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

const letsToolOwnsStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTask(setup.registry, Node);
  addTool(
    setup.registry,
    defineTool({
      description: "Starts work in a conversation it owns",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              api.commit(
                (tx) =>
                  runNested(
                    Effect.gen(function* () {
                      const child = yield* awaited(
                        tx.createConversation({
                          ownership: { kind: "task", taskId: api.taskId },
                        }),
                      );
                      yield* awaited(
                        tx.createTask(
                          Node,
                          { name: "sub" },
                          { ...OWN_CONVERSATION, conversationId: child.id },
                        ),
                      );
                    }),
                  ),
                callContext,
              ),
            );
            return { output: [{ text: "started", type: "text" }] };
          }),
        ),
      name: "delegate",
      parameters: Type.Object({}),
    }),
  );
  return { runPromise, setup };
});

const letsToolOwns = Effect.gen(function* () {
  const { setup } = yield* letsToolOwnsStep1;
  setup.faux.setResponses([
    toolCalls(["delegate", "c1"]),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* waitFor(
    Effect.gen(function* () {
      return (
        (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))?.tools?.[0]?.status === "done"
      );
    }),
  );
  const live = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!;
  const tool = live.tools![0]!.taskId!;
  expect(live.tools![0]!.entry).toBeDefined();
  expect((yield* state(harness, tool)).status).toBe("completing");
  expect((yield* state(harness, live.run!.taskId)).status).toBe("waiting");
  yield* waitFor(() => labels(events).includes("end:c1:true"));
  expect(yield* settled(submission.wait(context))).toBe(false);
  open("sub");
  expect((yield* awaited(submission.wait(context))).status).toBe("done");
  expect(yield* awaited(outcomeOf(harness, tool))).toBe("completed");
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("tool rounds and events", () => {
  it("lets a tool that owns live work finish its call at the hold while the generation waits for its final commit", () =>
    Effect.runPromise(letsToolOwns));
});

const holdsFaultedToolStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTask(setup.registry, Node);
  script("held", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(gate("abort.held").promise);
          yield* awaited(
            runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
          );
        }),
      ),
  });
  addTool(
    setup.registry,
    defineTool({
      description: "Starts owned work, then returns a result that is not strict JSON",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(
              api.commit(
                (tx) => tx.createTask(Node, { name: "held" }, owned(api.taskId)),
                callContext,
              ),
            );
            return { details: { fn: (() => 1) as unknown as JsonValue }, output: [] };
          }),
        ),
      name: "broken",
      parameters: Type.Object({}),
    }),
  );
  setup.faux.setResponses([toolCalls(["broken", "c1"]), fauxAssistantMessage([fauxText("done")])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const { stream, events } = yield* listen(harness, root);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* waitFor(() => log.includes("abort:held"));
  const live = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!;
  const tool = live.tools![0]!.taskId!;
  return { events, harness, live, stream, submission, tool };
});

const holdsFaultedTool = Effect.gen(function* () {
  const { harness, stream, events, submission, live, tool } = yield* holdsFaultedToolStep1;
  expect(yield* state(harness, tool)).toMatchObject({
    outcome: { status: "faulted" },
    status: "completing",
  });
  expect(live.tools![0]!.status).not.toBe("done");
  expect(events.some((event) => event.type === "task_failed")).toBe(false);
  open("abort.held");
  expect((yield* awaited(submission.wait(context))).status).toBe("done");
  expect(yield* awaited(outcomeOf(harness, tool))).toBe("faulted");
  yield* waitFor(() => events.some((event) => event.type === "task_failed"));
  expect(labels(events)).toContain("end:c1:false");
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("tool rounds and events", () => {
  it("holds a faulted tool's slot and task_failed until the work it owns drained", () =>
    Effect.runPromise(holdsFaultedTool));
});
