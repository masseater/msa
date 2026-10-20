import { Clock, Effect, Fiber } from "effect";

import type progressTypes from "./progress.types.ts";

const PROGRESS_BYTES_PER_SECOND = 100 * 1024;

const now = (): number => Effect.runSync(Clock.currentTimeMillis);

class Progress implements progressTypes.Progress {
  readonly #write: () => Promise<number>;
  readonly #onError: (error: unknown) => void;
  readonly #minIntervalMs: number;
  #waiters: PromiseWithResolvers<void>[] = [];
  #timer: Fiber.Fiber<void> | undefined;
  #inFlight: Promise<void> | undefined;
  #nextAt = 0;
  #dirty = false;
  #stopped = false;

  constructor(
    write: () => Promise<number>,
    onError: (error: unknown) => void,
    minIntervalMs: number,
  ) {
    this.#write = write;
    this.#onError = onError;
    this.#minIntervalMs = minIntervalMs;
  }

  mark(): void {
    this.#dirty = true;
    this.#schedule();
  }

  markAndWait(): Promise<void> {
    const waiter = Promise.withResolvers<void>();
    this.#waiters.push(waiter);
    this.mark();
    return waiter.promise;
  }

  stop(): Promise<PromiseWithResolvers<void>[]> {
    this.#stopped = true;
    this.#cancelTimer();
    const drain = (): PromiseWithResolvers<void>[] => this.#waiters.splice(0);
    return Promise.resolve(this.#inFlight).then(drain);
  }

  #cancelTimer(): void {
    const timer = this.#timer;
    this.#timer = undefined;
    if (timer !== undefined) Effect.runFork(Fiber.interrupt(timer));
  }

  #schedule(): void {
    if (this.#stopped || this.#timer !== undefined || this.#inFlight !== undefined) return;
    const wait = this.#nextAt - now();
    if (wait <= 0) this.#flush();
    else
      this.#timer = Effect.runFork(
        Effect.flatMap(Effect.sleep(wait), () =>
          Effect.sync(() => {
            this.#timer = undefined;
            this.#flush();
          }),
        ),
      );
  }

  #flush(): void {
    if (this.#stopped || !this.#dirty) return;
    this.#dirty = false;
    const waiters = this.#waiters.splice(0);
    const started = now();
    this.#inFlight = this.#write()
      .then(
        (bytes) => {
          this.#nextAt =
            started + Math.max(this.#minIntervalMs, (bytes * 1000) / PROGRESS_BYTES_PER_SECOND);
          for (const waiter of waiters) waiter.resolve();
          return undefined;
        },
        (error: unknown) => {
          this.#nextAt = started + this.#minIntervalMs;
          for (const waiter of waiters) waiter.reject(error);
          this.#onError(error);
        },
      )
      .finally(() => {
        this.#inFlight = undefined;
        if (this.#dirty) this.#schedule();
      });
  }
}

const progress = {
  PROGRESS_BYTES_PER_SECOND,
  Progress,
};

export default progress;
