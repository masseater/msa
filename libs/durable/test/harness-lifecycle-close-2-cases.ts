import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import harnessLifecycleSupport from "./harness-lifecycle-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { MemoryStorage } = memory;

const { awaited } = effectSupport;
const { oneStep, start } = harnessLifecycleSupport;
const { context } = sessionSupport;
const { openTasks } = taskSupport;

const paused = Effect.fn("paused")(function* () {
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
              tx.createSubmission({ conversationId: root.id, status: "queued", type: "write" }),
            )).id;
          }),
        ),
      context,
    ),
  );
  return { harness, id, ran: () => ran, root, submissionId };
});

export default paused;
