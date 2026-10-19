import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness } from "../../src/harness/index.ts";
import { defineExtension, defineTask } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;

const payments = new Map<string, number>();
type PaymentState = { phase: "prepare" } | { phase: "charge"; key: string };
const Payment = defineTask<{ amount: number }, PaymentState, { receipt: number }>({
  name: "example.payment",
  version: 1,
  initial: () => ({ phase: "prepare" }),
  phases: {
    prepare: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({
                  status: "running",
                  checkpoint: { phase: "charge", key: `payment-${task.id}` },
                }),
                taskContext,
              ),
            ),
          ),
        ),
      ),
    charge: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const key = task.state.checkpoint.key;
          if (!payments.has(key)) payments.set(key, task.input.amount * 100);
          const receipt = payments.get(key)!;
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "completed", result: { receipt } } }),
              taskContext,
            ),
          );
        }),
      ),
  },
  abort: (_task, runtime, taskContext) =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.suspend(() =>
          awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              taskContext,
            ),
          ),
        ),
      ),
    ),
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
