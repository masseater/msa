import { Console, Effect, Fiber, Schema } from "effect";

import host from "../../src/runtime/host.ts";

const { CodemodeSandbox } = host;

const how = process.argv[2];
if (how !== "abort" && how !== "timeout" && how !== "close")
  throw new Error(`Unknown stop mode: ${how}`);
let started = performance.now();
process.on("exit", () => {
  Effect.runSync(
    Console.log(JSON.stringify({ elapsedMs: performance.now() - started, type: "exit" })),
  );
});
const controller = new AbortController();
let timer: Fiber.Fiber<void> | undefined;
let workerExited = false;
const sandbox = new CodemodeSandbox({
  memoryLimitBytes: 256 * 1024 * 1024,
  onWorkerStarted: (exited) => {
    void exited.then(() => {
      workerExited = true;
      return workerExited;
    });
  },
  tools: [
    {
      execute: () => {
        started = performance.now();
        if (how !== "timeout") {
          timer = Effect.runFork(
            Effect.sleep(100).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (how === "abort") controller.abort();
                  else void sandbox.close();
                }),
              ),
            ),
          );
        }
      },
      name: "ready",
    },
  ],
});

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const closeSandbox = Effect.promise(() => sandbox.close());

const stopTimer = Effect.suspend(() =>
  timer === undefined ? Effect.void : Effect.asVoid(Fiber.interrupt(timer)),
);

const program = Effect.gen(function* () {
  const result = yield* Effect.promise(() =>
    sandbox.execute(
      "await tools.ready(); return 'a'.repeat(300000).indexOf('a'.repeat(10000) + 'b')",
      { signal: controller.signal, timeoutMs: how === "timeout" ? 300 : Number.POSITIVE_INFINITY },
    ),
  );
  if (result.ok)
    return yield* Effect.die(new Error("The script completed instead of being cancelled"));
  yield* closeSandbox;
  const line = yield* Effect.orDie(
    encodeLine({
      elapsedMs: performance.now() - started,
      kind: result.error.kind,
      type: "result",
      workerExited,
    }),
  );
  yield* Console.log(line);
}).pipe(Effect.ensuring(Effect.andThen(stopTimer, closeSandbox)));

void Effect.runPromise(program);
