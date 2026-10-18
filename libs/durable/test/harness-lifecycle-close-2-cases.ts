import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { start, oneStep } from "./harness-lifecycle-support.ts";
import { context } from "./session-support.ts";
import { openTasks } from "./task-support.ts";

export const paused = Effect.fn("paused")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let ran = false;
  const Marker = oneStep("test.marker", () => {
    ran = true;

    return Promise.resolve();
  });
  const { harness } = yield* openTasks(new MemoryStorage(), [Marker]);
  const root = yield* awaited(harness.root(context));
  const id = yield* awaited(start(root, Marker, true));
  const submissionId = yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(
              tx.createSubmission({ conversationId: root.id, type: "write", status: "queued" }),
            )).id;
          }),
        ),
      context,
    ),
  );
  return { harness, root, id, submissionId, ran: () => ran };
});
