import { Effect, Fiber, Layer, ManagedRuntime } from "effect";

import type { PrWatchGh } from "./gh.ts";
import type { PrWatchTarget } from "./snapshot.ts";
import {
  createPrWatchEntry,
  type PrNotification,
  type PrWatchEntry,
  type PrWatchHost,
  prWatchKey,
  prWatchLoop,
} from "./watch.ts";

export interface PrWatchOptions {
  readonly gh: PrWatchGh;
  readonly host: PrWatchHost;
  readonly defaultIntervalMs: () => number;
  readonly statusIntervalMs: () => number;
}

export interface PrWatchStart {
  readonly entry: PrWatchEntry;
  readonly started: boolean;
}

export interface PrWatchLastNotification {
  readonly key: string;
  readonly target: string;
  readonly change: string;
}

export interface PrWatchSnapshot {
  readonly entries: readonly PrWatchEntry[];
  readonly last: PrWatchLastNotification | undefined;
}

export class PrWatch {
  readonly #entries = new Map<string, PrWatchEntry>();
  readonly #fibers = new Map<string, Fiber.Fiber<void, never>>();
  readonly #gh: PrWatchGh;
  readonly #host: PrWatchHost;
  readonly #defaultIntervalMs: () => number;
  readonly #statusIntervalMs: () => number;
  readonly #runtime: ManagedRuntime.ManagedRuntime<never, never>;
  #last: PrWatchLastNotification | undefined;

  constructor(options: PrWatchOptions) {
    this.#gh = options.gh;
    this.#host = options.host;
    this.#defaultIntervalMs = options.defaultIntervalMs;
    this.#statusIntervalMs = options.statusIntervalMs;
    this.#runtime = ManagedRuntime.make(Layer.empty);
  }

  watch(target: PrWatchTarget, intervalMs?: number): PrWatchStart {
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
      prWatchLoop({ gh: this.#gh, entry, host: this.#hostFor(entry) }),
    );
    this.#fibers.set(key, fiber);
    return { entry, started: true };
  }

  stop(target: PrWatchTarget): boolean {
    const key = prWatchKey(target);
    const fiber = this.#fibers.get(key);
    this.#fibers.delete(key);
    const removed = this.#entries.delete(key);
    if (fiber !== undefined) Effect.runFork(Fiber.interrupt(fiber));
    return removed;
  }

  snapshot(): PrWatchSnapshot {
    return { entries: [...this.#entries.values()], last: this.#last };
  }

  dispose(): Promise<void> {
    for (const fiber of this.#fibers.values()) Effect.runFork(Fiber.interrupt(fiber));
    this.#fibers.clear();
    this.#entries.clear();
    this.#last = undefined;
    return this.#runtime.dispose();
  }

  #hostFor(entry: PrWatchEntry): PrWatchHost {
    return {
      notify: (notification: PrNotification) => {
        this.#last = { key: entry.key, target: entry.label, change: notification.label };
        this.#host.notify(notification);
      },
      changed: () => this.#host.changed(),
    };
  }
}
