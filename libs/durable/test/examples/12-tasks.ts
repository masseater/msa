import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { Harness, createRegistry } from "../../src/harness/index.ts";
import { defineExtension, defineTask } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import effectSupport from "../effect-support.ts";

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

const payments = new Map<string, number>();
type PaymentState = { phase: "prepare" } | { phase: "charge"; key: string };
const Payment = defineTask<{ amount: number }, PaymentState, { receipt: number }>({
  abort: (_task, runtime, taskContext) =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.suspend(() =>
          awaited(
            runtime.commit(
              () => ({ outcome: { status: "aborted" }, status: "terminal" }),
              taskContext,
            ),
          ),
        ),
      ),
    ),
  initial: () => ({ phase: "prepare" }),
  name: "example.payment",
  phases: {
    charge: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const key = task.state.checkpoint.key;
          if (!payments.has(key)) payments.set(key, task.input.amount * 100);
          const receipt = payments.get(key)!;
          yield* awaited(
            runtime.commit(
              () => ({ outcome: { result: { receipt }, status: "completed" }, status: "terminal" }),
              taskContext,
            ),
          );
        }),
      ),
    prepare: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({
                  checkpoint: { key: `payment-${task.id}`, phase: "charge" },
                  status: "running",
                }),
                taskContext,
              ),
            ),
          ),
        ),
      ),
  },
  version: 1,
});

const registry = createRegistry();
registry.install(defineExtension({ name: "payments", tasks: [Payment] }));

const main = Effect.gen(function* () {
  const harness = yield* awaited(
    Harness.open(new MemoryStorage(), { models: createModels(), registry }, context),
  );
  const root = yield* awaited(harness.root(context));
  const paymentId = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Payment, { amount: 5 }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const paid = yield* awaited(harness.waitForTask(paymentId, context));
  yield* Console.log("payment outcome:", paid.state.outcome);

  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
