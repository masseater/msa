import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { currentTimeMillis } from "../../src/clock.ts";
import { Harness, createRegistry } from "../../src/harness/index.ts";
import {
  type Conversation,
  type TaskGraph,
  type TaskGraphNode,
  type TaskId,
  defineExtension,
  defineTask,
} from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import effectSupport from "../effect-support.ts";
import platformSupport from "../platform-support.ts";

const { awaited } = effectSupport;
const { joinPath, makeTempDir, removeDir } = platformSupport;

const context = BACKGROUND_CONTEXT;

const charged = new Set<string>();

type PaymentInput = { card: string };
type PaymentResult = { card: string };
const Payment = defineTask<PaymentInput, { phase: "charge"; at: number }, PaymentResult>({
  abort: (task, runtime, taskContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const refunded = charged.delete(task.input.card);
        yield* Console.log(`  payment ${task.input.card} aborted${refunded ? ", refunded" : ""}`);
        yield* awaited(
          runtime.commit(
            () => ({ outcome: { status: "aborted" }, status: "terminal" }),
            taskContext,
          ),
        );
      }),
    ),
  initial: () => ({ at: currentTimeMillis() + 100, phase: "charge" }),
  name: "example.payment",
  phases: {
    charge: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const card = task.input.card;
          if (card.startsWith("expired")) {
            const error = { message: `${card} declined` };
            yield* awaited(
              runtime.commit(
                () => ({ outcome: { error, status: "failed" }, status: "terminal" }),
                taskContext,
              ),
            );
            return;
          }
          charged.add(card);
          yield* awaited(runtime.sleep(task.state.checkpoint.at, taskContext));
          yield* awaited(
            runtime.commit(
              () => ({ outcome: { result: { card }, status: "completed" }, status: "terminal" }),
              taskContext,
            ),
          );
        }),
      ),
  },
  version: 1,
});

type CheckoutState = { phase: "pay" } | { phase: "decide"; payments: TaskId<PaymentResult>[] };
const Checkout = defineTask<{ cards: string[] }, CheckoutState, string>({
  abort: (_task, runtime, taskContext) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Console.log("  checkout aborted");
        yield* awaited(
          runtime.commit(
            () => ({ outcome: { status: "aborted" }, status: "terminal" }),
            taskContext,
          ),
        );
      }),
    ),
  initial: () => ({ phase: "pay" }),
  name: "example.checkout",
  phases: {
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
                  ? { outcome: { result: "order placed", status: "completed" }, status: "terminal" }
                  : {
                      outcome: { error: { message: "payment failed" }, status: "failed" },
                      status: "terminal",
                    },
              taskContext,
            ),
          );
        }),
      ),
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
                      checkpoint: { payments, phase: "decide" },
                      on: payments,
                      policy: "failFast",
                      status: "waiting",
                    };
                  }),
                ),
              taskContext,
            ),
          );
        }),
      ),
  },
  version: 1,
});

const registry = createRegistry();
registry.install(defineExtension({ name: "checkout", tasks: [Payment, Checkout] }));

const mainStep1 = Effect.gen(function* () {
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
  return { checkout, directory, open, printGraph };
});

const main = Effect.gen(function* () {
  const { directory, open, printGraph, checkout } = yield* mainStep1;
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
