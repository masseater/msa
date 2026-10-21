import { Effect, Fiber, Layer, ManagedRuntime } from "effect";

import type ghTypes from "./gh.types.ts";
import type serviceTypes from "./service.types.ts";
import type snapshotTypes from "./snapshot.types.ts";
import watchModule from "./watch.ts";
import type watchTypes from "./watch.types.ts";

const { createPrWatchEntry, prWatchKey, prWatchLoop } = watchModule;

export default class PrWatch {
  readonly #entries = new Map<string, watchTypes.PrWatchEntry>();
  readonly #fibers = new Map<string, Fiber.Fiber<void, never>>();
  readonly #gh: ghTypes.PrWatchGh;
  readonly #host: watchTypes.PrWatchHost;
  readonly #defaultIntervalMs: () => number;
  readonly #statusIntervalMs: () => number;
  readonly #runtime: ManagedRuntime.ManagedRuntime<never, never>;
  #last: serviceTypes.PrWatchLastNotification | undefined;

  constructor(options: serviceTypes.PrWatchOptions) {
    this.#gh = options.gh;
    this.#host = options.host;
    this.#defaultIntervalMs = options.defaultIntervalMs;
    this.#statusIntervalMs = options.statusIntervalMs;
    this.#runtime = ManagedRuntime.make(Layer.empty);
  }

  watch(target: snapshotTypes.PrWatchTarget, intervalMs?: number): serviceTypes.PrWatchStart {
    const key = prWatchKey(target);
    const existing = this.#entries.get(key);
    if (existing !== undefined && existing.status === "watching") {
      return { entry: existing, started: false };
    }
    const entry = createPrWatchEntry(
      target,
      intervalMs ?? this.#defaultIntervalMs(),
      this.#statusIntervalMs(),
    );
    this.#entries.set(key, entry);
    const fiber = this.#runtime.runFork(
      prWatchLoop({ entry, gh: this.#gh, host: this.#hostFor(entry) }),
    );
    this.#fibers.set(key, fiber);
    return { entry, started: true };
  }

  stop(target: snapshotTypes.PrWatchTarget): boolean {
    const key = prWatchKey(target);
    const fiber = this.#fibers.get(key);
    this.#fibers.delete(key);
    const removed = this.#entries.delete(key);
    if (fiber !== undefined) Effect.runFork(Fiber.interrupt(fiber));
    return removed;
  }

  snapshot(): serviceTypes.PrWatchSnapshot {
    return { entries: [...this.#entries.values()], last: this.#last };
  }

  dispose(): Promise<void> {
    for (const fiber of this.#fibers.values()) Effect.runFork(Fiber.interrupt(fiber));
    this.#fibers.clear();
    this.#entries.clear();
    this.#last = undefined;
    return this.#runtime.dispose();
  }

  #hostFor(entry: watchTypes.PrWatchEntry): watchTypes.PrWatchHost {
    return {
      changed: () => this.#host.changed(),
      notify: (notification: watchTypes.PrNotification) => {
        this.#last = { change: notification.label, key: entry.key, target: entry.label };
        this.#host.notify(notification);
      },
    };
  }
}
