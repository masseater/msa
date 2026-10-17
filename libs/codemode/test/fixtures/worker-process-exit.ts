import { Console, Effect, Fiber } from "effect";

import { CodemodeSandbox } from "../../src/runtime/host.ts";

const how = process.argv[2];
if (how !== "abort" && how !== "timeout" && how !== "close")
  throw new Error(`Unknown stop mode: ${how}`);
let started = performance.now();
process.on("exit", () => {
  Effect.runSync(
    Console.log(JSON.stringify({ type: "exit", elapsedMs: performance.now() - started })),
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
      name: "ready",
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
    },
  ],
});
try {
  const result = await sandbox.execute(
    "await tools.ready(); return 'a'.repeat(300000).indexOf('a'.repeat(10000) + 'b')",
    { signal: controller.signal, timeoutMs: how === "timeout" ? 300 : Number.POSITIVE_INFINITY },
  );
  if (result.ok) throw new Error("The script completed instead of being cancelled");
  await sandbox.close();
  await Effect.runPromise(
    Console.log(
      JSON.stringify({
        type: "result",
        kind: result.error.kind,
        elapsedMs: performance.now() - started,
        workerExited,
      }),
    ),
  );
} finally {
  if (timer !== undefined) await Effect.runPromise(Fiber.interrupt(timer));
  await sandbox.close();
}
