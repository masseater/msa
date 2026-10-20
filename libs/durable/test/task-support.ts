import { createModels } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type harnessTypes from "@msa/durable/harness.types";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";

import clockModule from "../src/clock.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { currentTimeMillis } = clockModule;
const { Harness, createRegistry } = harnessModule;
const { defineExtension } = durable;

const { awaited } = effectSupport;
const { context, flush } = sessionSupport;

const deferred = <T = void>(): PromiseWithResolvers<T> => Promise.withResolvers<T>();

function aborted(signal: AbortSignal): Promise<never> {
  const { promise, reject } = Promise.withResolvers<never>();
  if (signal.aborted) reject(signal.reason);
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  return promise;
}

const eventually = Effect.fn("eventually")(function* (
  check: () => boolean | Promise<boolean>,
  timeoutMs = 4_000,
) {
  const deadline = currentTimeMillis() + timeoutMs;
  while (!(yield* awaited(check()))) {
    if (currentTimeMillis() >= deadline) throw new Error("Condition was not reached");
    yield* flush;
  }
});

const abortMarked = Effect.fn("abortMarked")(function* (
  harness: harnessTypes.Harness,
  id: durableTypes.TaskId,
) {
  while ((yield* awaited(harness.getTask(id, context)))?.abortRequested !== true) yield* flush;
});

const settled = Effect.fn("settled")(function* (promise: Promise<unknown>) {
  let done = false;
  promise.then(
    () => {
      done = true;
      return undefined;
    },
    () => {
      done = true;
      return undefined;
    },
  );
  yield* flush;
  return done;
});

const openTasks = Effect.fn("openTasks")(function* (
  storage: durableTypes.Storage,
  tasks: readonly durableTypes.AnyTask[],
  options: {
    readonly registry?: durableTypes.Registry;
    readonly now?: () => number;
    readonly settings?: durableTypes.HarnessSettings;
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
        onReport: (error) => reports.push(error),
        registry,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.settings === undefined ? {} : { settings: options.settings }),
      },
      context,
    ),
  );
  return { harness, registry, reports };
});

function completed<R>(result: R) {
  return { outcome: { result, status: "completed" }, status: "terminal" } as const;
}

function abortedWith(reason: string) {
  return { outcome: { reason, status: "aborted" }, status: "terminal" } as const;
}

function countingReader(
  registry: durableTypes.Registry,
): durableTypes.RegistryReader & { subscriptions(): number } {
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

const taskSupport = {
  abortMarked,
  aborted,
  abortedWith,
  completed,
  countingReader,
  deferred,
  eventually,
  openTasks,
  settled,
};

export default taskSupport;
