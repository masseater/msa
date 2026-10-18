import { type ConversationId, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted } from "./task-support.ts";

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

const cascadesThroughTaskStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let b: TaskId | undefined;
  script("a", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              b = yield* awaited(spawn(tx, runtime.taskId, "b"));
              return waitOn([b], "allSettled");
            }),
          ),
        ctx,
      ),
  });
  return { runPromise, harness, root };
});

const cascadesThroughTask = Effect.gen(function* () {
  const { runPromise, harness, root } = yield* cascadesThroughTaskStep1;
  let x: TaskId | undefined;
  script("b", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const conversation = yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    );
                    x = yield* awaited(
                      tx.createTask(
                        Node,
                        { name: "x" },
                        { ...OWN_CONVERSATION, conversationId: conversation.id },
                      ),
                    );
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
    resume: (runtime) => runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
  });
  const a = yield* awaited(start(root, "a"));
  yield* until(() => log.includes("run:x"));
  yield* awaited(harness.abortTask(a, context));
  expect(yield* awaited(outcomeOf(harness, a))).toBe("aborted");
  expect(yield* awaited(outcomeOf(harness, x!))).toBe("aborted");
  expect(log.filter((line) => line.startsWith("abort:"))).toEqual([
    "abort:x",
    "abort:b",
    "abort:a",
  ]);
  yield* awaited(harness.close(context));
});

describe("abort order", () => {
  it("cascades through task and conversation edges, bottom-up", () =>
    Effect.runPromise(cascadesThroughTask));
});

const keepsBackgroundWorkStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const foreground = yield* awaited(start(root, "foreground"));
  return { runPromise, harness, root, foreground };
});

const keepsBackgroundWork = Effect.gen(function* () {
  const { runPromise, harness, root, foreground } = yield* keepsBackgroundWorkStep1;
  let child: TaskId | undefined;
  let below: TaskId | undefined;
  script("background", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    child = yield* awaited(spawn(tx, runtime.taskId, "child"));
                    const conversation = yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    );
                    below = yield* awaited(
                      tx.createTask(
                        Node,
                        { name: "below" },
                        { ...OWN_CONVERSATION, conversationId: conversation.id },
                      ),
                    );
                    return waitOn([child], "allSettled");
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  const background = yield* awaited(
    start(root, "background", { ...OWN_CONVERSATION, background: true }),
  );
  yield* until(() => log.includes("run:below") && log.includes("run:child"));
  yield* awaited(root.abort(context));
  expect(yield* awaited(outcomeOf(harness, foreground))).toBe("aborted");
  for (const id of [background, child!, below!])
    expect((yield* state(harness, id)).status).not.toBe("terminal");
  yield* awaited(root.abort(context, { background: true }));
  for (const id of [background, child!, below!])
    expect((yield* state(harness, id)).status).toBe("terminal");
  yield* awaited(harness.close(context));
});

describe("boundaries", () => {
  it("keeps background work through Conversation.abort(); { background: true } aborts it and waits", () =>
    Effect.runPromise(keepsBackgroundWork));
});

const neverCascadesTerminal = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let conversation: ConversationId | undefined;
  script("agent", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    conversation = (yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    )).id;
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
    resume: (runtime) => runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
  });
  const agent = yield* awaited(start(root, "agent"));
  yield* until(() => log.includes("resume:agent"));
  yield* awaited(harness.abortTask(agent, context));
  expect(yield* awaited(outcomeOf(harness, agent))).toBe("aborted");
  const child = (yield* awaited(harness.conversation(conversation!, context)))!;
  const question = yield* awaited(start(child, "question"));
  open("question");
  expect(yield* awaited(outcomeOf(harness, question))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("boundaries", () => {
  it("never cascades from a terminal owner: an aborted subagent's conversation runs new work normally", () =>
    Effect.runPromise(neverCascadesTerminal));
});
