import { createModels } from "@msa/ai";
import {
  type AnyTask,
  defineExtension,
  type HarnessSettings,
  type Registry,
  type RegistryReader,
  type Storage,
  type TaskId,
} from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { Effect } from "effect";

import { currentTimeMillis } from "../src/clock.ts";
import { awaited } from "./effect-support.ts";
import { context, flush } from "./session-support.ts";

export type Deferred<T = void> = PromiseWithResolvers<T>;

export const deferred = <T = void>(): Deferred<T> => Promise.withResolvers<T>();

export function aborted(signal: AbortSignal): Promise<never> {
  const { promise, reject } = Promise.withResolvers<never>();
  if (signal.aborted) reject(signal.reason);
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  return promise;
}

export const eventually = Effect.fn("eventually")(function* (
  check: () => boolean | Promise<boolean>,
  timeoutMs = 4_000,
) {
  const deadline = currentTimeMillis() + timeoutMs;
  while (!(yield* awaited(check()))) {
    if (currentTimeMillis() >= deadline) throw new Error("Condition was not reached");
    yield* flush;
  }
});

export const abortMarked = Effect.fn("abortMarked")(function* (harness: Harness, id: TaskId) {
  while ((yield* awaited(harness.getTask(id, context)))?.abortRequested !== true) yield* flush;
});

export const settled = Effect.fn("settled")(function* (promise: Promise<unknown>) {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  yield* flush;
  return done;
});

export const openTasks = Effect.fn("openTasks")(function* (
  storage: Storage,
  tasks: readonly AnyTask[],
  options: {
    readonly registry?: Registry;
    readonly now?: () => number;
    readonly settings?: HarnessSettings;
  } = {},
) {
  const registry = options.registry ?? createRegistry();
  if (tasks.length > 0) registry.install(defineExtension({ name: "tasks", tasks }));
  const reports: unknown[] = [];
  const harness = yield* awaited(
    Harness.open(
      storage,
      {
        models: createModels(),
        registry,
        onReport: (error) => reports.push(error),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.settings === undefined ? {} : { settings: options.settings }),
      },
      context,
    ),
  );
  return { harness, registry, reports };
});

export function completed<R>(result: R) {
  return { status: "terminal", outcome: { status: "completed", result } } as const;
}

export function abortedWith(reason: string) {
  return { status: "terminal", outcome: { status: "aborted", reason } } as const;
}

export function countingReader(registry: Registry): RegistryReader & { subscriptions(): number } {
  let count = 0;
  return {
    snapshot: () => registry.snapshot(),
    subscribe: (listener) => {
      count++;
      const unsubscribe = registry.subscribe(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        count--;
        unsubscribe();
      };
    },
    subscriptions: () => count,
  };
}
