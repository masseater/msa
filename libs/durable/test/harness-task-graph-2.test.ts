import { defineTask, type EntryId } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited, context, completed, deferred, eventually, openTasks } from "./support.ts";

const listsOwnedConversations = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const gate = deferred();
  const created: number[] = [];
  const Spawner = defineTask<{ at: EntryId }, { phase: "spawn" }, null>({
    name: "test.graph-spawner",
    version: 1,
    initial: () => ({ phase: "spawn" }),
    phases: {
      spawn: (task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              runtime.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const ownership = { kind: "task", taskId: task.id } as const;
                      const [forked, fresh] = yield* awaited(
                        Promise.all([
                          tx.forkConversation(runtime.conversationId, task.input.at, {
                            ownership,
                          }),
                          tx.createConversation({ ownership }),
                        ]),
                      );
                      created.push(forked.id, fresh.id);
                      return undefined;
                    }),
                  ),
                ctx,
              ),
            );
            yield* awaited(gate.promise);
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
  const { harness } = yield* openTasks(new MemoryStorage(), [Spawner]);
  const root = yield* awaited(harness.root(context));
  const graph = yield* awaited(harness.taskGraph(context));
  const id = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const entry = yield* awaited(tx.appendEntry(root.id, { kind: "note" }));
            return yield* awaited(
              tx.createTask(Spawner, { at: entry.id }, { ownership: { kind: "conversation" } }),
            );
          }),
        ),
      context,
    ),
  );
  harness.resume();
  yield* eventually(() => (graph.value.tasks[String(id)]?.conversations.length ?? 0) === 2);
  const advanced = graph.value;
  expect(advanced.tasks[String(id)]!.conversations).toEqual([...created].sort((a, b) => a - b));
  graph.dispose();
  const rebuilt = yield* awaited(harness.taskGraph(context));
  expect(rebuilt.value).toEqual(advanced);
  rebuilt.dispose();
  gate.resolve();
  yield* awaited(harness.waitForTask(id, context));
  yield* awaited(harness.close(context));
});

describe("task graph view", () => {
  it("lists owned conversations in ID order whatever order one commit creates them in", () =>
    Effect.runPromise(listsOwnedConversations));
});
