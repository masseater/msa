import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gate,
  gates,
  until,
  start,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  script,
  spawnAndFinish,
  directories,
} from "./harness-structured-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";

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

const marksHeldCompleted = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const child = spawnAndFinish("held", "child");
  const held = yield* awaited(start(root, "held"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, held)).status === "completing";
      }),
    ),
  );
  yield* awaited(root.abort(context));
  expect(yield* awaited(outcomeOf(harness, child.id!))).toBe("aborted");
  const record = yield* awaited(harness.waitForTask(held, context));
  expect(record.state.outcome.status).toBe("completed");
  expect(record.abortRequested).toBe(true);
  yield* awaited(harness.close(context));
});

const marksAwaitsOnly = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  script("first", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(gate("abort.first").promise);
          yield* awaited(
            runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
          );
        }),
      ),
  });
  const background = { ...OWN_CONVERSATION, background: true };
  const first = yield* awaited(start(root, "first", background));
  yield* until(() => log.includes("run:first"));
  const aborting = root.abort(context, { background: true });
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.getTask(first, context)))!.abortRequested;
      }),
    ),
  );
  const later = yield* awaited(start(root, "later", background));
  open("abort.first");
  yield* awaited(aborting);
  expect((yield* state(harness, later)).status).not.toBe("terminal");
  expect((yield* awaited(harness.getTask(later, context)))!.abortRequested).toBe(false);
  yield* awaited(harness.abortTask(later, context));
  yield* awaited(harness.close(context));
});

describe("conversation abort and boundaries", () => {
  it("marks a held completed task with Conversation.abort(): the work below is aborted, the outcome stays", () =>
    Effect.runPromise(marksHeldCompleted));

  it("marks and awaits only the background work reached when { background: true } is admitted", () =>
    Effect.runPromise(marksAwaitsOnly));
});

const stopsCascadeUnmarked = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  script("owner", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(gate("abort.owner").promise);
          yield* awaited(
            runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
          );
        }),
      ),
  });
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const owner = yield* awaited(tx.createTask(Node, { name: "owner" }, OWN_CONVERSATION));
            const outer = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: owner } }),
            );
            const background = yield* awaited(
              tx.createTask(
                Node,
                { name: "background" },
                { ...OWN_CONVERSATION, conversationId: outer.id, background: true },
              ),
            );
            const inner = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: background },
              }),
            );
            return { owner, outer: outer.id, background, inner: inner.id };
          }),
        ),
      context,
    ),
  );
  yield* until(() => log.includes("run:owner") && log.includes("run:background"));
  yield* awaited(harness.abortTask(tree.owner, context));
  yield* until(() => log.includes("abort:owner"));
  const inner = (yield* awaited(harness.conversation(tree.inner, context)))!;
  const outer = (yield* awaited(harness.conversation(tree.outer, context)))!;
  const shielded = yield* awaited(start(inner, "shielded"));
  const exposed = yield* awaited(start(outer, "exposed"));
  expect(yield* awaited(outcomeOf(harness, exposed))).toBe("aborted");
  expect((yield* awaited(harness.getTask(shielded, context)))!.abortRequested).toBe(false);
  yield* awaited(harness.abortTask(tree.background, context));
  expect(yield* awaited(outcomeOf(harness, shielded))).toBe("aborted");
  expect(yield* awaited(outcomeOf(harness, tree.background))).toBe("aborted");
  open("abort.owner");
  expect(yield* awaited(outcomeOf(harness, tree.owner))).toBe("aborted");
  yield* awaited(harness.close(context));
});

describe("conversation abort and boundaries", () => {
  it("stops a cascade at an unmarked background task, but not at a marked one", () =>
    Effect.runPromise(stopsCascadeUnmarked));
});
