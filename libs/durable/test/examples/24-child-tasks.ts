import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { currentTimeMillis } from "../../src/clock.ts";
import { createRegistry, Harness } from "../../src/harness/index.ts";
import {
  type Conversation,
  defineExtension,
  defineTask,
  type TaskGraph,
  type TaskGraphNode,
  type TaskId,
} from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { awaited } from "../effect-support.ts";
import { joinPath, makeTempDir, removeDir } from "../platform-support.ts";

const context = BACKGROUND_CONTEXT;

const charged = new Set<string>();

type PaymentInput = { card: string };
type PaymentResult = { card: string };
const Payment = defineTask<PaymentInput, { phase: "charge"; at: number }, PaymentResult>({
  name: "example.payment",
  version: 1,
  initial: () => ({ phase: "charge", at: currentTimeMillis() + 100 }),
  phases: {
    charge: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const card = task.input.card;
          if (card.startsWith("expired")) {
            const error = { message: `${card} declined` };
            yield* awaited(
              runtime.commit(
                () => ({ status: "terminal", outcome: { status: "failed", error } }),
                taskContext,
              ),
            );
            return;
          }
          charged.add(card);
          yield* awaited(runtime.sleep(task.state.checkpoint.at, taskContext));
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "completed", result: { card } } }),
              taskContext,
            ),
          );
        }),
      ),
  },
  abort: (task, runtime, taskContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const refunded = charged.delete(task.input.card);
        yield* Console.log(`  payment ${task.input.card} aborted${refunded ? ", refunded" : ""}`);
        yield* awaited(
          runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            taskContext,
          ),
        );
      }),
    ),
});

type CheckoutState = { phase: "pay" } | { phase: "decide"; payments: TaskId<PaymentResult>[] };
const Checkout = defineTask<{ cards: string[] }, CheckoutState, string>({
  name: "example.checkout",
  version: 1,
  initial: () => ({ phase: "pay" }),
  phases: {
    pay: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const payments: TaskId<PaymentResult>[] = [];
                    for (const card of task.input.cards) {
                      payments.push(
                        yield* awaited(
                          tx.createTask(
                            Payment,
                            { card },
                            { ownership: { kind: "task", taskId: task.id } },
                          ),
                        ),
                      );
                    }
                    return {
                      status: "waiting",
                      checkpoint: { phase: "decide", payments },
                      on: payments,
                      policy: "failFast",
                    };
                  }),
                ),
              taskContext,
            ),
          );
        }),
      ),
    decide: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const outcomes = yield* awaited(
            runtime.outcomes(task.state.checkpoint.payments, taskContext),
          );
          yield* Console.log(`  payments: ${outcomes.map((outcome) => outcome.status).join(", ")}`);
          const paid = outcomes.every((outcome) => outcome.status === "completed");
          yield* awaited(
            runtime.commit(
              () =>
                paid
                  ? { status: "terminal", outcome: { status: "completed", result: "order placed" } }
                  : {
                      status: "terminal",
                      outcome: { status: "failed", error: { message: "payment failed" } },
                    },
              taskContext,
            ),
          );
        }),
      ),
  },
  abort: (_task, runtime, taskContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Console.log("  checkout aborted");
        yield* awaited(
          runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            taskContext,
          ),
        );
      }),
    ),
});

const registry = createRegistry();
registry.install(defineExtension({ name: "checkout", tasks: [Payment, Checkout] }));

const main = Effect.gen(function* () {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-example-");
  const databasePath = joinPath(directory, "session.sqlite");
  const open = Effect.fn("open")(function* () {
    return yield* awaited(
      Harness.open(
        yield* awaited(openNodeSqliteStorage(databasePath)),
        { models: createModels(), registry },
        context,
      ),
    );
  });
  function printGraph(graph: TaskGraph): void {
    const nodes = Object.values(graph.tasks);
    const print = (node: TaskGraphNode, depth: number): void => {
      const state = node.state;
      const status =
        state.status === "waiting" ? `waiting on ${state.on.join(", ")}` : state.status;
      runSync(Console.log(`  ${"  ".repeat(depth)}${node.kind} ${node.id}: ${status}`));
      for (const child of nodes.filter((candidate) => candidate.owner === node.id))
        print(child, depth + 1);
    };
    for (const node of nodes.filter((candidate) => candidate.owner === undefined)) print(node, 0);
  }
  const checkout = (root: Conversation, cards: string[]) =>
    root.commit(
      (tx) => tx.createTask(Checkout, { cards }, { ownership: { kind: "conversation" } }),
      context,
    );

  let harness = yield* open();
  let root = yield* awaited(harness.root(context));

  yield* Console.log("One card is declined:");
  let id = yield* awaited(checkout(root, ["visa-1", "expired-2", "visa-3", "visa-4"]));
  yield* Console.log(
    `  checkout: ${(yield* awaited(harness.waitForTask(id, context))).state.outcome.status}`,
  );

  yield* Console.log("The customer cancels:");
  id = yield* awaited(checkout(root, ["visa-5", "visa-6", "visa-7", "visa-8"]));
  harness.resume();
  yield* Effect.sleep(20);
  const graph = yield* awaited(harness.taskGraph(context));
  printGraph(graph.value);
  graph.dispose();
  yield* awaited(harness.abortTask(id, context));
  yield* Console.log(
    `  checkout: ${(yield* awaited(harness.waitForTask(id, context))).state.outcome.status}`,
  );

  yield* Console.log("The process stops while the payments run, and a new one continues:");
  id = yield* awaited(checkout(root, ["visa-9", "visa-10", "visa-11", "visa-12"]));
  yield* Effect.sleep(20);
  yield* awaited(harness.close(context));
  harness = yield* open();
  yield* awaited(harness.root(context));
  yield* Console.log(
    `  checkout: ${(yield* awaited(harness.waitForTask(id, context))).state.outcome.status}`,
  );

  yield* awaited(harness.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);
