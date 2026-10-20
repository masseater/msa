import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { vi } from "vite-plus/test";

import type harnessOwnershipSupportTypes from "./harness-ownership-support.types.ts";
import testSupport from "./support.ts";

const { LiveDoc, defineTask } = durable;
const { MemoryStorage } = memory;

const { awaited, pollUntil } = testSupport;
const { context } = testSupport;
const { aborted, deferred, openTasks } = testSupport;

const gates = new Map<string, PromiseWithResolvers<harnessOwnershipSupportTypes.Ending>>();

function gate(name: string): PromiseWithResolvers<harnessOwnershipSupportTypes.Ending> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<harnessOwnershipSupportTypes.Ending>();
    gates.set(name, found);
  }
  return found;
}

const runs = new Map<string, number>();

const Hold = defineTask<{ name: string; slowAbort?: boolean }, { phase: "hold" }, null>({
  abort: (task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (task.input.slowAbort === true) yield* awaited(gate(`abort.${task.input.name}`).promise);
        yield* awaited(
          runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
        );
      }),
    ),
  initial: () => ({ phase: "hold" }),
  name: "test.hold",
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
                  ? { outcome: { result: null, status: "completed" }, status: "terminal" }
                  : {
                      outcome: { error: { message: "gate failed" }, status: "failed" },
                      status: "terminal",
                    },
              ctx,
            ),
          );
        }),
      ),
  },
  version: 1,
});

const Waiter = defineTask<
  { on: durableTypes.TaskId[] },
  { phase: "wait" } | { phase: "done" },
  null
>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "wait" }),
  name: "test.waiter",
  phases: {
    done: (_task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          () => ({ outcome: { result: null, status: "completed" }, status: "terminal" }),
          ctx,
        ),
      ),
    wait: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = { phase: "done" } as const;
          yield* awaited(
            runtime.commit(
              () => ({ checkpoint, on: task.input.on, policy: "allSettled", status: "waiting" }),
              ctx,
            ),
          );
        }),
      ),
  },
  version: 1,
});

const Spawner = defineTask<{ name: string }, { phase: "spawn" }, null>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "spawn" }),
  name: "test.spawner",
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
                    { conversationId: child.id, ownership: { kind: "conversation" } },
                  ),
                );
                return { outcome: { result: null, status: "completed" }, status: "terminal" };
              }),
            ),
          ctx,
        ),
      ),
  },
  version: 1,
});

function openImpl(name: string, ending: harnessOwnershipSupportTypes.Ending): void {
  gate(name).resolve(ending);
}

const open: {
  (ending: harnessOwnershipSupportTypes.Ending): (name: string) => ReturnType<typeof openImpl>;
  (name: string, ending: harnessOwnershipSupportTypes.Ending): ReturnType<typeof openImpl>;
} = dual(2, openImpl);

const directories = new Set<string>();

function ownedChildImpl(
  parent: durableTypes.Conversation,
  name: string,
  options: { background?: boolean; slowInner?: boolean; slowOwner?: boolean } = {},
): Promise<harnessOwnershipSupportTypes.Tree> {
  return Promise.resolve(
    parent.commit(
      (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const owner = yield* awaited(
              tx.createTask(
                Hold,
                { name, ...(options.slowOwner === true ? { slowAbort: true } : {}) },
                { background: options.background ?? false, ownership: { kind: "conversation" } },
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
                { conversationId: child.id, ownership: { kind: "conversation" } },
              ),
            );
            return { child: child.id, inner, owner };
          }),
        ),
      context,
    ),
  );
}

const ownedChild: {
  (
    name: string,
    options?: { background?: boolean; slowInner?: boolean; slowOwner?: boolean },
  ): (parent: durableTypes.Conversation) => ReturnType<typeof ownedChildImpl>;
  (
    parent: durableTypes.Conversation,
    name: string,
    options?: { background?: boolean; slowInner?: boolean; slowOwner?: boolean },
  ): ReturnType<typeof ownedChildImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, ownedChildImpl);

function gated(message: aiTypes.AssistantMessage): {
  step: aiTypes.FauxResponseStep;
  reached: Promise<void>;
  release: () => void;
} {
  const reached = deferred();
  const gateInner = deferred();
  const step: aiTypes.FauxResponseStep = (_request, options) =>
    Effect.runPromise(
      Effect.gen(function* () {
        reached.resolve();
        yield* awaited(Promise.race([gateInner.promise, aborted(options!.signal!)]));
        return message;
      }),
    );
  return { reached: reached.promise, release: () => gateInner.resolve(), step };
}

const waitUntil = (check: Effect.Effect<boolean>): Effect.Effect<void> => pollUntil(check, 500, 5);

const busy = Effect.fn("busy")(function* (
  conversation: durableTypes.Conversation,
  task: durableTypes.TaskId,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* awaited(
    conversation.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversation.id))).run = { inputs: [], taskId: task };
          }),
        ),
      context,
    ),
  );
});

const status = Effect.fn("status")(function* (
  harness: durableTypes.Harness,
  id: durableTypes.TaskId,
) {
  return (yield* awaited(harness.getTask(id, context)))!.state;
});

const openHarness = Effect.fn("openHarness")(function* (
  storage: durableTypes.Storage = new MemoryStorage(),
) {
  const opened = yield* openTasks(storage, [Hold, Waiter, Spawner]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  return { ...opened, root };
});

const setEntriesDuring = Effect.fn("setEntriesDuring")(function* (measured: () => Promise<void>) {
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

const harnessOwnershipSupport = {
  Hold,
  Spawner,
  Waiter,
  busy,
  directories,
  gate,
  gated,
  gates,
  open,
  openHarness,
  ownedChild,
  runs,
  setEntriesDuring,
  status,
  waitUntil,
};

export default harnessOwnershipSupport;
