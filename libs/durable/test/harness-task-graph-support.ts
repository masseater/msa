import { defineTask, type TaskGraph, type TaskId } from "@msa/durable";

import { completed } from "./task-support.ts";

export type ParentState =
  | { phase: "spawn" }
  | { phase: "join"; child: TaskId }
  | { phase: "finish" };

// A child that completes once its gate opens: `late` children wait on `gates.late`.
export function graphChild(gates: { readonly child: Promise<void>; readonly late: Promise<void> }) {
  return defineTask<{ late: boolean }, { phase: "work" }, null>({
    name: "test.graph-child",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: async (task, runtime, ctx) => {
        await (task.input.late ? gates.late : gates.child);
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async () => {},
  });
}

// A parent that creates a child task and a conversation it owns, waits for the child, creates a second child, and
// completes while that child is still live, so its outcome is held as `completing`.
export function family(gates: { readonly child: Promise<void>; readonly late: Promise<void> }) {
  const Child = graphChild(gates);
  const Parent = defineTask<null, ParentState, null>({
    name: "test.graph-parent",
    version: 1,
    initial: () => ({ phase: "spawn" }),
    phases: {
      spawn: async (task, runtime, ctx) => {
        const ownership = { kind: "task", taskId: task.id } as const;
        // Two conversations in a commit that leaves the parent's record unchanged.
        await runtime.commit(async (tx) => {
          await tx.createConversation({ ownership });
          await tx.createConversation({ ownership });
          return undefined;
        }, ctx);
        await runtime.commit(async (tx) => {
          const child = await tx.createTask(Child, { late: false }, { ownership });
          return {
            status: "waiting",
            checkpoint: { phase: "join", child },
            on: [child],
            policy: "allSettled",
          };
        }, ctx);
      },
      join: async (task, runtime, ctx) => {
        await runtime.commit(async (tx) => {
          await tx.createTask(
            Child,
            { late: true },
            { ownership: { kind: "task", taskId: task.id } },
          );
          return { status: "running", checkpoint: { phase: "finish" } };
        }, ctx);
      },
      finish: async (_task, runtime, ctx) => {
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async () => {},
  });
  return { Parent, Child };
}

// Node states by task kind, for compact assertions.
export function statuses(graph: TaskGraph): Record<string, string> {
  return Object.fromEntries(
    Object.values(graph.tasks).map(
      (node) => [`${node.kind}#${node.id}`, node.state.status] as const,
    ),
  );
}
