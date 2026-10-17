import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import type { HookRunner, NextTaskState, RunningTask, TaskRuntime, Tx } from "./types.ts";

export const toPromise = <Args extends readonly unknown[], A>(
  f: (...args: Args) => Effect.Effect<A>,
): Effect.Effect<(...args: Args) => Promise<A>> =>
  Effect.map(
    Effect.context<never>(),
    (services) =>
      (...args: Args): Promise<A> =>
        Effect.runPromiseWith(services)(f(...args)),
  );

export const runPromised =
  <Args extends readonly unknown[], A>(f: (...args: Args) => Effect.Effect<A>) =>
  (...args: Args): Promise<A> =>
    Effect.runPromise(f(...args));

export type TaskChange<I, S, R> = (
  tx: Tx,
  current: RunningTask<I, S, R>,
) => Effect.Effect<NextTaskState<S, R> | undefined>;

export const commitTask: {
  <I, S, R>(
    change: TaskChange<I, S, R>,
    context: Context,
  ): <H extends object>(runtime: TaskRuntime<I, S, R, H>) => Effect.Effect<void>;
  <I, S, R, H extends object>(
    runtime: TaskRuntime<I, S, R, H>,
    change: TaskChange<I, S, R>,
    context: Context,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* <I, S, R, H extends object>(
    runtime: TaskRuntime<I, S, R, H>,
    change: TaskChange<I, S, R>,
    context: Context,
  ) {
    const run = yield* toPromise(change);
    yield* Effect.promise(() => runtime.commit(run, context));
  }),
);

export const eachHook: {
  <H extends object, K extends keyof H>(
    name: K,
    invoke: (handler: NonNullable<H[K]>) => Effect.Effect<void>,
  ): (runner: HookRunner<H>) => Effect.Effect<void>;
  <H extends object, K extends keyof H>(
    runner: HookRunner<H>,
    name: K,
    invoke: (handler: NonNullable<H[K]>) => Effect.Effect<void>,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  <H extends object, K extends keyof H>(
    runner: HookRunner<H>,
    name: K,
    invoke: (handler: NonNullable<H[K]>) => Effect.Effect<void>,
  ): Effect.Effect<void> =>
    Effect.flatMap(toPromise(invoke), (run) => Effect.promise(() => runner.each(name, run))),
);

export const hookResult = <T>(
  call: () => T | undefined | Promise<T | undefined>,
): Effect.Effect<T | undefined> => Effect.promise(() => Promise.resolve(call()));
