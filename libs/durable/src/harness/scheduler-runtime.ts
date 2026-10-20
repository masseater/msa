import type { Context, JsonValue } from "@msa/chord";
import { awaitWithContext } from "@msa/chord/context";
import { Cause, Duration, Effect, Exit } from "effect";

import promiseTryModule from "../promise-try.ts";
import stepModule from "../step.ts";
import agentModule from "./agent.ts";
import schedulerKit from "./scheduler-kit.ts";
import type schedulerRuntimeReadsTypes from "./scheduler-runtime-reads.types.ts";
import schedulerTypes from "./scheduler-types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { schedulerFinalize, schedulerRecords, schedulerRuntimeReads } = schedulerKit;

const { endedError, memoOf, sessionMethod } = schedulerRecords;
const { agentHooks } = agentModule;
const { MAX_TIMER_DELAY } = schedulerTypes;
const { promiseTry } = promiseTryModule;
const { settleStep } = stepModule;
const { commitState } = schedulerFinalize;
const { runtimeReads } = schedulerRuntimeReads;

type RuntimeInput = schedulerRuntimeReadsTypes.RuntimeParts & {
  readonly phase: schedulerTypesModule.Phase;
};

type NextState = schedulerTypesModule.NextTaskState<schedulerTypesModule.Checkpoint, JsonValue>;

const isPromiseLike = <T>(value: T | PromiseLike<T>): value is PromiseLike<T> =>
  typeof (value as { then?: unknown } | undefined)?.then === "function";

const agentOf =
  ({ state, invocation, phase }: RuntimeInput) =>
  (): Promise<schedulerTypesModule.Agent> => {
    if (invocation.ended) return Promise.reject(endedError(invocation));
    if (phase.agent === undefined) {
      phase.agent = state.options.agent(
        invocation.conversationId,
        phase.snapshot(),
        invocation.context,
      );
      phase.agent.catch(() => {});
    }
    return phase.agent;
  };

const eachHandler = Effect.fnUntraced(function* (
  input: RuntimeInput,
  agent: () => Promise<schedulerTypesModule.Agent>,
  name: PropertyKey,
  invoke: (handler: never) => void | Promise<void>,
) {
  const { state, invocation, phase } = input;
  const resolved = yield* Effect.promise(agent);
  for (const handlers of agentHooks(resolved, phase.task().definition.name)) {
    const handler = (handlers as Record<PropertyKey, unknown>)[name];
    if (typeof handler !== "function") continue;
    const exit = yield* Effect.exit(
      Effect.promise(() => Promise.resolve(invoke(handler.bind(handlers) as never))),
    );
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      if (invocation.controller.signal.aborted) throw error;
      state.options.report(error);
    }
  }
});

const aborted = (signal: AbortSignal): Effect.Effect<never> =>
  Effect.callback<never>((resume) => {
    const onAbort = (): void => resume(Effect.die(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

const sleepUntil = Effect.fnUntraced(function* (
  { state, invocation }: schedulerRuntimeReadsTypes.RuntimeParts,
  until: number,
  context: Context,
) {
  if (invocation.ended) throw endedError(invocation);
  const signals = [invocation.controller.signal];
  if (context.abortSignal !== undefined) signals.push(context.abortSignal);
  const signal = AbortSignal.any(signals);
  for (;;) {
    signal.throwIfAborted();
    const remaining = until - state.options.now();
    if (remaining <= 0) return;
    yield* Effect.raceFirst(
      Effect.sleep(Duration.millis(Math.min(remaining, MAX_TIMER_DELAY))),
      aborted(signal),
    );
  }
});

const watchDoc = Effect.fnUntraced(function* (
  { state, invocation }: schedulerRuntimeReadsTypes.RuntimeParts,
  args: readonly unknown[],
) {
  if (invocation.ended) throw endedError(invocation);
  const watch = (yield* Effect.promise(() =>
    sessionMethod(state.options.session, "watchDoc")(...args),
  )) as schedulerTypesModule.DocumentWatch<schedulerTypesModule.JsonObject> | undefined;
  if (watch === undefined) return undefined;
  if (invocation.ended) {
    void watch.stop();
    throw endedError(invocation);
  }
  invocation.watches.add(watch);
  void watch.closed.then(() => invocation.watches.delete(watch));
  return watch;
});

const memo = (input: RuntimeInput) =>
  ((name: string, ...rest: readonly unknown[]) => {
    const { state, invocation } = input;
    if (rest.length === 1) {
      return state.read(invocation, () =>
        promiseTry(() => memoOf(state.graph.live.get(invocation.taskId), name)),
      );
    }
    const candidate = rest[0] as JsonValue;
    return state.gated(
      invocation,
      (tx, current) => {
        const winner = memoOf(current, name);
        if (winner !== undefined) return winner;
        tx.setTask({
          ...current,
          memos: { ...current.memos, [name]: candidate },
        } as schedulerTypesModule.AnyTaskRecord);
        return candidate;
      },
      rest[1] as Context,
    );
  }) as schedulerTypesModule.ErasedRuntime["memo"];

const runtimeWrites = (input: RuntimeInput) => {
  const { state, invocation } = input;
  return {
    commit: (
      change: Parameters<schedulerTypesModule.ErasedRuntime["commit"]>[0],
      context: Context,
    ): Promise<void> =>
      state.gated(
        invocation,
        (tx: schedulerTypesModule.Transaction, current: schedulerTypesModule.ErasedRunningTask) => {
          const settle = (next: NextState | undefined): void | Promise<void> =>
            next === undefined
              ? undefined
              : settleStep(commitState(state, tx, invocation, current, next), () => undefined);
          const next = change(tx, current);
          return isPromiseLike(next) ? Promise.resolve(next).then(settle) : settle(next);
        },
        context,
      ),
    memo: memo(input),
    sleep: (until: number, context: Context) =>
      Effect.runPromise(sleepUntil(input, until, context)),
    watchDoc: ((...args: readonly unknown[]) =>
      Effect.runPromise(watchDoc(input, args))) as schedulerTypesModule.ErasedRuntime["watchDoc"],
  };
};

const buildRuntime = (input: RuntimeInput): schedulerTypesModule.ErasedRuntime => {
  const { state, invocation, phase } = input;
  const agent = agentOf(input);
  const hooks: schedulerTypesModule.HookRunner<Record<string, unknown>> = {
    each: (name, invoke) =>
      Effect.runPromise(eachHandler(input, agent, name, invoke as (handler: never) => void)),
  };
  const settings = state.options.settings;
  return {
    agent: (context) =>
      invocation.ended
        ? Promise.reject(endedError(invocation))
        : awaitWithContext(agent(), context),
    conversationId: invocation.conversationId,
    env: (context) =>
      state.read(invocation, () => state.options.env(invocation.conversationId, context)),
    hooks: hooks as schedulerTypesModule.ErasedRuntime["hooks"],
    models: state.options.models,
    get registry() {
      return phase.snapshot();
    },
    get settings() {
      return settings();
    },
    signal: invocation.controller.signal,
    taskId: invocation.taskId as schedulerTypesModule.TaskId<JsonValue>,
    ...runtimeWrites(input),
    ...runtimeReads(input),
    now: () => {
      if (invocation.ended) throw endedError(invocation);
      return state.options.now();
    },
    report: (error) => {
      if (invocation.ended) throw endedError(invocation);
      state.options.report(error);
    },
  };
};

const schedulerRuntime = {
  buildRuntime,
};

export default schedulerRuntime;
