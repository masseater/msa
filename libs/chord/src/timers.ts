import { Duration, Effect, Fiber } from "effect";

const noop = (): void => {};

export class HostTimers {
  readonly #fibers = new Set<Fiber.Fiber<void>>();
  #closed = false;

  after(ms: number, fire: () => void): () => void {
    return this.#run(Effect.delay(Effect.sync(fire), Duration.millis(ms)));
  }

  every(ms: number, tick: () => void): () => void {
    return this.#run(Effect.forever(Effect.delay(Effect.sync(tick), Duration.millis(ms))));
  }

  close(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#closed = true;
      const fibers = [...this.#fibers];
      this.#fibers.clear();
      return Fiber.interruptAll(fibers);
    });
  }

  #run(effect: Effect.Effect<void>): () => void {
    if (this.#closed) return noop;
    const fiber = Effect.runFork(effect);
    this.#fibers.add(fiber);
    fiber.addObserver(() => this.#fibers.delete(fiber));
    return () => {
      if (this.#fibers.delete(fiber)) Effect.runFork(Fiber.interrupt(fiber));
    };
  }
}
