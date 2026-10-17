import { type AssistantMessage, type FauxResponseStep } from "@msa/ai";
import {
  type Conversation,
  type ConversationId,
  defineTask,
  type Harness,
  LiveDoc,
  MemoryStorage,
  type Storage,
  type TaskId,
} from "@msa/durable";
import { vi } from "vite-plus/test";

import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred, openTasks } from "./task-support.ts";

/** Outcome a held task commits once its gate opens. */
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

/** How often each named task started its run phase. */
export const runs = new Map<string, number>();

/**
 * A task that holds until its named gate opens or it is aborted. With `slowAbort`, its abort handler first waits for
 * the gate `abort.<name>`.
 */
export const Hold = defineTask<{ name: string; slowAbort?: boolean }, { phase: "hold" }, null>({
  name: "test.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: async (task, runtime, ctx) => {
      runs.set(task.input.name, (runs.get(task.input.name) ?? 0) + 1);
      const ending = await Promise.race([gate(task.input.name).promise, aborted(runtime.signal)]);
      await runtime.commit(
        () =>
          ending === "completed"
            ? { status: "terminal", outcome: { status: "completed", result: null } }
            : {
                status: "terminal",
                outcome: { status: "failed", error: { message: "gate failed" } },
              },
        ctx,
      );
    },
  },
  abort: async (task, runtime, ctx) => {
    if (task.input.slowAbort === true) await gate(`abort.${task.input.name}`).promise;
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
  },
});

/** Waits on the tasks in its input, then completes; its abort handler ends it `aborted`. */
export const Waiter = defineTask<{ on: TaskId[] }, { phase: "wait" } | { phase: "done" }, null>({
  name: "test.waiter",
  version: 1,
  initial: () => ({ phase: "wait" }),
  phases: {
    wait: async (task, runtime, ctx) => {
      const checkpoint = { phase: "done" } as const;
      await runtime.commit(
        () => ({ status: "waiting", checkpoint, on: task.input.on, policy: "allSettled" }),
        ctx,
      );
    },
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

/** Tries to create, in the commit that ends it, a conversation it owns with a held task in it, named by its input. */
export const Spawner = defineTask<{ name: string }, { phase: "spawn" }, null>({
  name: "test.spawner",
  version: 1,
  initial: () => ({ phase: "spawn" }),
  phases: {
    spawn: (task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(async (tx) => {
          const child = await tx.createConversation({
            ownership: { kind: "task", taskId: task.id },
          });
          await tx.createTask(
            Hold,
            { name: task.input.name },
            { ownership: { kind: "conversation" }, conversationId: child.id },
          );
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }, ctx),
      ),
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

export function open(name: string, ending: Ending): void {
  gate(name).resolve(ending);
}

export const directories = new Set<string>();

export type Tree = { owner: TaskId; child: ConversationId; inner: TaskId };

// In `parent`, stage task `owner` and a conversation it owns holding task `inner`, in one commit.
export function ownedChild(
  parent: Conversation,
  name: string,
  options: { background?: boolean; slowInner?: boolean; slowOwner?: boolean } = {},
): Promise<Tree> {
  return Promise.resolve(
    parent.commit(async (tx) => {
      const owner = await tx.createTask(
        Hold,
        { name, ...(options.slowOwner === true ? { slowAbort: true } : {}) },
        { ownership: { kind: "conversation" }, background: options.background ?? false },
      );
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
      const inner = await tx.createTask(
        Hold,
        { name: `${name}.inner`, ...(options.slowInner === true ? { slowAbort: true } : {}) },
        { ownership: { kind: "conversation" }, conversationId: child.id },
      );
      return { owner, child: child.id, inner };
    }, context),
  );
}

// A faux response held until `release` or cancellation; `reached` resolves when the request is sent.
export function gated(message: AssistantMessage): {
  step: FauxResponseStep;
  reached: Promise<void>;
  release: () => void;
} {
  const reached = deferred();
  const gate = deferred();
  const step: FauxResponseStep = async (_request, options) => {
    reached.resolve();
    await Promise.race([gate.promise, aborted(options!.signal!)]);
    return message;
  };
  return { step, reached: reached.promise, release: () => gate.resolve() };
}

export async function waitUntil(check: () => Promise<boolean>, attempt = 0): Promise<void> {
  if (await check()) return;
  if (attempt >= 500) throw new Error("Condition was not reached");
  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
  await waitUntil(check, attempt + 1);
}

// Mark a conversation busy with `task` standing in for its run, so submissions queue.
export async function busy(conversation: Conversation, task: TaskId): Promise<void> {
  await conversation.commit(async (tx) => {
    (await tx.doc(LiveDoc, conversation.id)).run = { taskId: task, inputs: [] };
  }, context);
}

export async function status(harness: Harness, id: TaskId) {
  return (await harness.getTask(id, context))!.state;
}

export async function openHarness(storage: Storage = new MemoryStorage()) {
  const opened = await openTasks(storage, [Hold, Waiter, Spawner]);
  const root = await opened.harness.root(context);
  opened.harness.resume();
  return { ...opened, root };
}

// Run `measured` and count the entries Set iteration yields meanwhile.
export async function setEntriesDuring(measured: () => Promise<void>): Promise<number> {
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
  try {
    await measured();
  } finally {
    spy.mockRestore();
  }
  return entries;
}
