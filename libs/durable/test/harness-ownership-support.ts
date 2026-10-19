import { type AssistantMessage, type FauxResponseStep } from "@msa/ai";
import {
  type Conversation,
  type ConversationId,
  defineTask,
  type Harness,
  LiveDoc,
  type Storage,
  type TaskId,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { vi } from "vite-plus/test";

import { awaited, pollUntil } from "./effect-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred, openTasks } from "./task-support.ts";

export type Ending = "completed" | "failed";

export const gates = new Map<string, Deferred<Ending>>();

export function gate(name: string): Deferred<Ending> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<Ending>();
    gates.set(name, found);
  }
  return found;
}

export const runs = new Map<string, number>();

export const Hold = defineTask<{ name: string; slowAbort?: boolean }, { phase: "hold" }, null>({
  name: "test.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          runs.set(task.input.name, (runs.get(task.input.name) ?? 0) + 1);
          const ending = yield* awaited(
            Promise.race([gate(task.input.name).promise, aborted(runtime.signal)]),
          );
          yield* awaited(
            runtime.commit(
              () =>
                ending === "completed"
                  ? { status: "terminal", outcome: { status: "completed", result: null } }
                  : {
                      status: "terminal",
                      outcome: { status: "failed", error: { message: "gate failed" } },
                    },
              ctx,
            ),
          );
        }),
      ),
  },
  abort: (task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (task.input.slowAbort === true) yield* awaited(gate(`abort.${task.input.name}`).promise);
        yield* awaited(
          runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
        );
      }),
    ),
});

export const Waiter = defineTask<{ on: TaskId[] }, { phase: "wait" } | { phase: "done" }, null>({
  name: "test.waiter",
  version: 1,
  initial: () => ({ phase: "wait" }),
  phases: {
    wait: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = { phase: "done" } as const;
          yield* awaited(
            runtime.commit(
              () => ({ status: "waiting", checkpoint, on: task.input.on, policy: "allSettled" }),
              ctx,
            ),
          );
        }),
      ),
    done: (_task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
          ctx,
        ),
      ),
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

export const Spawner = defineTask<{ name: string }, { phase: "spawn" }, null>({
  name: "test.spawner",
  version: 1,
  initial: () => ({ phase: "spawn" }),
  phases: {
    spawn: (task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          (tx) =>
            Effect.runPromise(
              Effect.gen(function* () {
                const child = yield* awaited(
                  tx.createConversation({
                    ownership: { kind: "task", taskId: task.id },
                  }),
                );
                yield* awaited(
                  tx.createTask(
                    Hold,
                    { name: task.input.name },
                    { ownership: { kind: "conversation" }, conversationId: child.id },
                  ),
                );
                return { status: "terminal", outcome: { status: "completed", result: null } };
              }),
            ),
          ctx,
        ),
      ),
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

function openImpl(name: string, ending: Ending): void {
  gate(name).resolve(ending);
}

export const open: {
  (ending: Ending): (name: string) => ReturnType<typeof openImpl>;
  (name: string, ending: Ending): ReturnType<typeof openImpl>;
} = dual(2, openImpl);

export const directories = new Set<string>();

export type Tree = { owner: TaskId; child: ConversationId; inner: TaskId };

function ownedChildImpl(
  parent: Conversation,
  name: string,
  options: { background?: boolean; slowInner?: boolean; slowOwner?: boolean } = {},
): Promise<Tree> {
  return Promise.resolve(
    parent.commit(
      (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const owner = yield* awaited(
              tx.createTask(
                Hold,
                { name, ...(options.slowOwner === true ? { slowAbort: true } : {}) },
                { ownership: { kind: "conversation" }, background: options.background ?? false },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: owner } }),
            );
            const inner = yield* awaited(
              tx.createTask(
                Hold,
                {
                  name: `${name}.inner`,
                  ...(options.slowInner === true ? { slowAbort: true } : {}),
                },
                { ownership: { kind: "conversation" }, conversationId: child.id },
              ),
            );
            return { owner, child: child.id, inner };
          }),
        ),
      context,
    ),
  );
}

export const ownedChild: {
  (
    name: string,
    options?: { background?: boolean; slowInner?: boolean; slowOwner?: boolean },
  ): (parent: Conversation) => ReturnType<typeof ownedChildImpl>;
  (
    parent: Conversation,
    name: string,
    options?: { background?: boolean; slowInner?: boolean; slowOwner?: boolean },
  ): ReturnType<typeof ownedChildImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, ownedChildImpl);

export function gated(message: AssistantMessage): {
  step: FauxResponseStep;
  reached: Promise<void>;
  release: () => void;
} {
  const reached = deferred();
  const gate = deferred();
  const step: FauxResponseStep = (_request, options) =>
    Effect.runPromise(
      Effect.gen(function* () {
        reached.resolve();
        yield* awaited(Promise.race([gate.promise, aborted(options!.signal!)]));
        return message;
      }),
    );
  return { step, reached: reached.promise, release: () => gate.resolve() };
}

export const waitUntil = (check: Effect.Effect<boolean>): Effect.Effect<void> =>
  pollUntil(check, 500, 5);

export const busy = Effect.fn("busy")(function* (conversation: Conversation, task: TaskId) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* awaited(
    conversation.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversation.id))).run = { taskId: task, inputs: [] };
          }),
        ),
      context,
    ),
  );
});

export const status = Effect.fn("status")(function* (harness: Harness, id: TaskId) {
  return (yield* awaited(harness.getTask(id, context)))!.state;
});

export const openHarness = Effect.fn("openHarness")(function* (
  storage: Storage = new MemoryStorage(),
) {
  const opened = yield* openTasks(storage, [Hold, Waiter, Spawner]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  return { ...opened, root };
});

export const setEntriesDuring = Effect.fn("setEntriesDuring")(function* (
  measured: () => Promise<void>,
) {
  const values = Set.prototype.values;
  let entries = 0;
  function* counted(this: Set<unknown>) {
    for (const value of values.call(this)) {
      entries++;
      yield value;
    }
  }
  const spy = vi
    .spyOn(Set.prototype, Symbol.iterator)
    .mockImplementation(counted as unknown as () => SetIterator<unknown>);
  yield* awaited(measured()).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())));
  return entries;
});
