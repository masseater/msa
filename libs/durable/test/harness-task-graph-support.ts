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

function graphParent(Child: ReturnType<typeof graphChild>) {
  return defineTask<null, ParentState, null>({
    name: "test.graph-parent",
    version: 1,
    initial: () => ({ phase: "spawn" }),
    phases: {
      spawn: (task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const ownership = { kind: "task", taskId: task.id } as const;
            yield* awaited(
              runtime.commit(
                (tx) =>
                  tx
                    .createConversation({ ownership })
                    .then(() => tx.createConversation({ ownership }))
                    .then(() => undefined),
                ctx,
              ),
            );
            yield* awaited(
              runtime.commit(
                (tx) =>
                  tx.createTask(Child, { late: false }, { ownership }).then(
                    (child) =>
                      ({
                        status: "waiting",
                        checkpoint: { phase: "join", child },
                        on: [child],
                        policy: "allSettled",
                      }) as const,
                  ),
                ctx,
              ),
            );
          }),
        ),
      join: (task, runtime, ctx) =>
        runtime.commit(
          (tx) =>
            tx
              .createTask(Child, { late: true }, { ownership: { kind: "task", taskId: task.id } })
              .then(() => ({ status: "running", checkpoint: { phase: "finish" } }) as const),
          ctx,
        ),
      finish: (_task, runtime, ctx) => runtime.commit(() => completed(null), ctx),
    },
    abort: () => Promise.resolve(),
  });
}

export function family(gates: { readonly child: Promise<void>; readonly late: Promise<void> }) {
  const Child = graphChild(gates);
  return { Parent: graphParent(Child), Child };
}

export function statuses(graph: TaskGraph): Record<string, string> {
  return Object.fromEntries(
    Object.values(graph.tasks).map(
      (node) => [`${node.kind}#${node.id}`, node.state.status] as const,
    ),
  );
}
