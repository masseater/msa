import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { currentTimeMillis } from "../../src/clock.ts";
import { Harness, createRegistry } from "../../src/harness/index.ts";
import { defineExtension, defineTask } from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import effectSupport from "../effect-support.ts";
import platformSupport from "../platform-support.ts";

const { awaited } = effectSupport;
const { joinPath, makeTempDir, removeDir } = platformSupport;

const context = BACKGROUND_CONTEXT;

let reachedTick = (_n: number): void => {};
const Ticker = defineTask<{ to: number }, { phase: "tick"; n: number }, string>({
  abort: (_task, runtime, taskContext) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), taskContext),
    ).then(() => undefined),
  initial: () => ({ n: 1, phase: "tick" }),
  name: "example.ticker",
  phases: {
    tick: (task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const n = task.state.checkpoint.n;
          if ((yield* awaited(runtime.memo(`printed-${n}`, taskContext))) === undefined) {
            yield* awaited(runtime.memo(`printed-${n}`, true, taskContext));
            yield* Console.log(`tick ${n}`);
          }
          reachedTick(n);
          yield* awaited(
            runtime.commit(
              () =>
                n === task.input.to
                  ? {
                      outcome: { result: `counted to ${n}`, status: "completed" },
                      status: "terminal",
                    }
                  : { checkpoint: { n: n + 1, phase: "tick" }, status: "running" },
              taskContext,
            ),
          );
          yield* awaited(runtime.sleep(currentTimeMillis() + 50, taskContext));
        }),
      ),
  },
  version: 1,
});
const registry = createRegistry();
registry.install(defineExtension({ name: "ticker", tasks: [Ticker] }));

const open = Effect.fn("open")(function* (databasePath: string) {
  return yield* awaited(
    Harness.open(
      yield* awaited(openNodeSqliteStorage(databasePath)),
      { models: createModels(), registry },
      context,
    ),
  );
});

const main = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-durable-example-");
  const databasePath = joinPath(directory, "session.sqlite");

  const firstRun = yield* open(databasePath);
  const tickerId = yield* awaited(
    (yield* awaited(firstRun.root(context))).commit(
      (tx) => tx.createTask(Ticker, { to: 5 }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const { promise: tickTwo, resolve: reachTickTwo } = Promise.withResolvers<void>();
  reachedTick = (n) => {
    if (n === 2) reachTickTwo();
  };
  firstRun.resume();
  yield* awaited(tickTwo);
  yield* awaited(firstRun.close(context));
  reachedTick = () => {};

  const reader = yield* open(databasePath);
  const saved = (yield* awaited(reader.getTask(tickerId, context)))!;
  yield* awaited(reader.close(context));
  yield* Console.log("closed; saved checkpoint:", saved.state, "memos:", saved.memos);

  const secondRun = yield* open(databasePath);
  const counted = yield* awaited(secondRun.waitForTask(tickerId, context));
  yield* Console.log("after reopen:", counted.state.outcome);
  yield* awaited(secondRun.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);
