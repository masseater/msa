import { Effect, Fiber, FiberSet, Scope } from "effect";

import unrefSleepModule from "./unref-sleep.ts";

const { unrefSleep } = unrefSleepModule;

export default class HostTimers {
  readonly #fibers: FiberSet.FiberSet<void>;

  constructor(scope: Scope.Scope) {
    this.#fibers = Effect.runSync(Scope.provide(FiberSet.make<void>(), scope));
  }

  after(ms: number, fire: () => void): () => void {
    return this.#run(Effect.andThen(unrefSleep(ms), Effect.sync(fire)));
  }

  every(ms: number, tick: () => void): () => void {
    return this.#run(Effect.forever(Effect.andThen(unrefSleep(ms), Effect.sync(tick))));
  }

  #run(effect: Effect.Effect<void>): () => void {
    const fiber = Effect.runSync(FiberSet.run(this.#fibers, effect));
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }
}
