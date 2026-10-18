import { type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { toJsonText, awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const letsBackgroundTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let owner: TaskId | undefined;
  script("background", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([owner!], "allSettled"), ctx),
  });
  const background = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            owner = yield* awaited(tx.createTask(Node, { name: "owner" }, OWN_CONVERSATION));
            const conversation = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: owner },
              }),
            );
            const options = {
              ...OWN_CONVERSATION,
              conversationId: conversation.id,
              background: true,
            };
            return yield* awaited(tx.createTask(Node, { name: "background" }, options));
          }),
        ),
      context,
    ),
  );
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, background)).status === "waiting";
      }),
    ),
  );
  open("owner");
  expect(yield* awaited(outcomeOf(harness, background))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("lets a background task wait on the owner of its conversation", () =>
    Effect.runPromise(letsBackgroundTask));
});

const rejectsCycleHoldStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const ids: Record<string, TaskId> = {};
  const reviewerWaits = deferred();
  script("orchestrator", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              ids["worker"] = yield* awaited(spawn(tx, runtime.taskId, "worker"));
              return { status: "running", checkpoint: { phase: "resume", round: 1 } };
            }),
          ),
        ctx,
      ),
  });
  script("reviewer", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(runtime.commit(() => waitOn([ids["orchestrator"]!], "allSettled"), ctx));
          reviewerWaits.resolve();
        }),
      ),
  });
  script("worker", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(reviewerWaits.promise);
          yield* awaited(runtime.commit(() => waitOn([ids["reviewer"]!], "allSettled"), ctx));
        }),
      ),
  });
  ids["orchestrator"] = yield* awaited(start(root, "orchestrator"));
  return { runPromise, harness, root, ids };
});

const rejectsCycleHold = Effect.gen(function* () {
  const { runPromise, harness, root, ids } = yield* rejectsCycleHoldStep1;
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, ids["orchestrator"]!)).status === "completing";
      }),
    ),
  );
  ids["reviewer"] = yield* awaited(start(root, "reviewer"));
  const outcomes = yield* awaited(
    Promise.all(
      ["orchestrator", "worker", "reviewer"].map((name) => outcomeOf(harness, ids[name]!)),
    ),
  );
  expect(outcomes).toEqual(["completed", "faulted", "completed"]);
  const worker = (yield* awaited(harness.waitForTask(ids["worker"]!, context))).state.outcome;
  expect(yield* toJsonText(worker)).toContain(
    `${ids["worker"]} -> ${ids["reviewer"]} -> ${ids["orchestrator"]} -> ${ids["worker"]} is a wait cycle`,
  );
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("rejects a cycle of a hold and two waits that each look reasonable", () =>
    Effect.runPromise(rejectsCycleHold));
});

const allowsDiamondWaits = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const ids: Record<string, TaskId> = {};
  script("top", {
    run: (runtime, ctx) =>
      runtime.commit(() => waitOn([ids["left"]!, ids["right"]!], "allSettled"), ctx),
  });
  script("left", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([ids["bottom"]!], "allSettled"), ctx),
  });
  script("right", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([ids["bottom"]!], "allSettled"), ctx),
  });
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            ids["bottom"] = yield* awaited(
              tx.createTask(Node, { name: "bottom" }, OWN_CONVERSATION),
            );
            ids["left"] = yield* awaited(tx.createTask(Node, { name: "left" }, OWN_CONVERSATION));
            ids["right"] = yield* awaited(tx.createTask(Node, { name: "right" }, OWN_CONVERSATION));
            ids["top"] = yield* awaited(tx.createTask(Node, { name: "top" }, OWN_CONVERSATION));
          }),
        ),
      context,
    ),
  );
  open("bottom");
  const topId = ids["top"];
  if (topId === undefined) throw new Error("Expected the top task id");
  expect(yield* awaited(outcomeOf(harness, topId))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("waiting", () => {
  it("allows a diamond of waits", () => Effect.runPromise(allowsDiamondWaits));
});
