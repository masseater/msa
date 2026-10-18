import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { currentTimeMillis } from "../../src/clock.ts";
import { createRegistry, Harness } from "../../src/harness/index.ts";
import { defineExtension, defineTask } from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { awaited } from "../effect-support.ts";
import { joinPath, makeTempDir, removeDir } from "../platform-support.ts";

const context = BACKGROUND_CONTEXT;

const main = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-example-");
  const databasePath = joinPath(directory, "session.sqlite");

  let reachedTick = (_n: number): void => {};
  const Ticker = defineTask<{ to: number }, { phase: "tick"; n: number }, string>({
    name: "example.ticker",
    version: 1,
    initial: () => ({ phase: "tick", n: 1 }),
    phases: {
      tick: (task, runtime, taskContext) =>
        runPromise(
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
                        status: "terminal",
                        outcome: { status: "completed", result: `counted to ${n}` },
                      }
                    : { status: "running", checkpoint: { phase: "tick", n: n + 1 } },
                taskContext,
              ),
            );
            yield* awaited(runtime.sleep(currentTimeMillis() + 50, taskContext));
          }),
        ),
    },
    abort: (_task, runtime, taskContext) =>
      runPromise(
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
  registry.install(defineExtension({ name: "ticker", tasks: [Ticker] }));
  const open = Effect.fn("open")(function* () {
    return yield* awaited(
      Harness.open(
        yield* awaited(openNodeSqliteStorage(databasePath)),
        { models: createModels(), registry },
        context,
      ),
    );
  });

  const firstRun = yield* open();
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

  const reader = yield* open();
  const saved = (yield* awaited(reader.getTask(tickerId, context)))!;
  yield* awaited(reader.close(context));
  yield* Console.log("closed; saved checkpoint:", saved.state, "memos:", saved.memos);

  const secondRun = yield* open();
  const counted = yield* awaited(secondRun.waitForTask(tickerId, context));
  yield* Console.log("after reopen:", counted.state.outcome);
  yield* awaited(secondRun.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);
