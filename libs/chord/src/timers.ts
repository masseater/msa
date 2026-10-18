import { Duration, Effect, Fiber, FiberSet, Scope } from "effect";

export class HostTimers {
  readonly #fibers: FiberSet.FiberSet<void>;

  constructor(scope: Scope.Scope) {
    this.#fibers = Effect.runSync(Scope.provide(FiberSet.make<void>(), scope));
  }

  after(ms: number, fire: () => void): () => void {
    return this.#run(Effect.delay(Effect.sync(fire), Duration.millis(ms)));
  }

  every(ms: number, tick: () => void): () => void {
    return this.#run(Effect.forever(Effect.delay(Effect.sync(tick), Duration.millis(ms))));
  }

  #run(effect: Effect.Effect<void>): () => void {
    const fiber = Effect.runSync(FiberSet.run(this.#fibers, effect));
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }
}
