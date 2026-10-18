import { defineTask, type TaskGraph, type TaskId } from "@msa/durable";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { completed } from "./task-support.ts";

export type ParentState =
  | { phase: "spawn" }
  | { phase: "join"; child: TaskId }
  | { phase: "finish" };

export function graphChild(gates: { readonly child: Promise<void>; readonly late: Promise<void> }) {
  return defineTask<{ late: boolean }, { phase: "work" }, null>({
    name: "test.graph-child",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(task.input.late ? gates.late : gates.child);
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
}

export function family(gates: { readonly child: Promise<void>; readonly late: Promise<void> }) {
  const Child = graphChild(gates);
  const Parent = defineTask<null, ParentState, null>({
    name: "test.graph-parent",
    version: 1,
    initial: () => ({ phase: "spawn" }),
    phases: {
      spawn: (task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            const ownership = { kind: "task", taskId: task.id } as const;
            yield* awaited(
              runtime.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      yield* awaited(tx.createConversation({ ownership }));
                      yield* awaited(tx.createConversation({ ownership }));
                      return undefined;
                    }),
                  ),
                ctx,
              ),
            );
            yield* awaited(
              runtime.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const child = yield* awaited(
                        tx.createTask(Child, { late: false }, { ownership }),
                      );
                      return {
                        status: "waiting",
                        checkpoint: { phase: "join", child },
                        on: [child],
                        policy: "allSettled",
                      };
                    }),
                  ),
                ctx,
              ),
            );
          }),
        ),
      join: (task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              runtime.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      yield* awaited(
                        tx.createTask(
                          Child,
                          { late: true },
                          { ownership: { kind: "task", taskId: task.id } },
                        ),
                      );
                      return { status: "running", checkpoint: { phase: "finish" } };
                    }),
                  ),
                ctx,
              ),
            );
          }),
        ),
      finish: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => completed(null), ctx)))),
        ),
    },
    abort: () => Promise.resolve(),
  });
  return { Parent, Child };
}

export function statuses(graph: TaskGraph): Record<string, string> {
  return Object.fromEntries(
    Object.values(graph.tasks).map(
      (node) => [`${node.kind}#${node.id}`, node.state.status] as const,
    ),
  );
}
