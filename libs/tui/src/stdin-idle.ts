import { Clock, Effect } from "effect";

const waitForStdinIdle = (maxMs: number, idleMs: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    let lastDataTime = clock.currentTimeMillisUnsafe();
    const onData = (): void => {
      lastDataTime = clock.currentTimeMillisUnsafe();
    };
    process.stdin.on("data", onData);
    const endTime = clock.currentTimeMillisUnsafe() + maxMs;
    const waitUntilIdle = Effect.gen(function* () {
      for (;;) {
        const now = clock.currentTimeMillisUnsafe();
        const timeLeft = endTime - now;
        if (timeLeft <= 0 || now - lastDataTime >= idleMs) return;
        yield* Effect.sleep(Math.min(idleMs, timeLeft));
      }
    });
    yield* waitUntilIdle.pipe(
      Effect.ensuring(Effect.sync(() => process.stdin.removeListener("data", onData))),
    );
  });

const stdinIdle = {
  waitForStdinIdle,
};

export default stdinIdle;
