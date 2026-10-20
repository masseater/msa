import { type TaskGraph, defineTask } from "@msa/durable";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import type harnessTaskGraphSupportTypes from "./harness-task-graph-support.types.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { completed } = taskSupport;

function graphChild(gates: { readonly child: Promise<void>; readonly late: Promise<void> }) {
  return defineTask<{ late: boolean }, { phase: "work" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "work" }),
    name: "test.graph-child",
    phases: {
      work: (task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(task.input.late ? gates.late : gates.child);
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    version: 1,
  });
}

function graphParent(Child: ReturnType<typeof graphChild>) {
  return defineTask<null, harnessTaskGraphSupportTypes.ParentState, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "spawn" }),
    name: "test.graph-parent",
    phases: {
      finish: (_task, runtime, ctx) => runtime.commit(() => completed(null), ctx),
      join: (task, runtime, ctx) =>
        runtime.commit(
          (tx) =>
            tx
              .createTask(Child, { late: true }, { ownership: { kind: "task", taskId: task.id } })
              .then(() => ({ checkpoint: { phase: "finish" }, status: "running" }) as const),
          ctx,
        ),
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
                        checkpoint: { child, phase: "join" },
                        on: [child],
                        policy: "allSettled",
                        status: "waiting",
                      }) as const,
                  ),
                ctx,
              ),
            );
          }),
        ),
    },
    version: 1,
  });
}

function family(gates: { readonly child: Promise<void>; readonly late: Promise<void> }) {
  const Child = graphChild(gates);
  return { Child, Parent: graphParent(Child) };
}

function statuses(graph: TaskGraph): Record<string, string> {
  return Object.fromEntries(
    Object.values(graph.tasks).map(
      (node) => [`${node.kind}#${node.id}`, node.state.status] as const,
    ),
  );
}

const harnessTaskGraphSupport = {
  family,
  graphChild,
  statuses,
};

export default harnessTaskGraphSupport;
