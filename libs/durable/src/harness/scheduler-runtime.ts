import type { Context, JsonValue } from "@msa/chord";
import { awaitWithContext } from "@msa/chord/context";
import { Cause, Duration, Effect, Exit } from "effect";

import { promiseTry } from "../promise-try.ts";
import { agentHooks } from "./agent.ts";
import { commitState } from "./scheduler-finalize.ts";
import { endedError, memoOf, sessionMethod } from "./scheduler-records.ts";
import { type RuntimeParts, runtimeReads } from "./scheduler-runtime-reads.ts";
import {
  type AnyTaskRecord,
  type ErasedRunningTask,
  type ErasedRuntime,
  MAX_TIMER_DELAY,
  type Phase,
  type Transaction,
  type Agent,
  type DocumentWatch,
  type HookRunner,
  type JsonObject,
  type TaskId,
} from "./scheduler-types.ts";

type RuntimeInput = RuntimeParts & { readonly phase: Phase };

const agentOf =
  ({ state, invocation, phase }: RuntimeInput) =>
  (): Promise<Agent> => {
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

const eachHandler = Effect.fn("eachHandler")(function* (
  input: RuntimeInput,
  agent: () => Promise<Agent>,
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

const sleepUntil = Effect.fn("sleepUntil")(function* (
  { state, invocation }: RuntimeParts,
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

const watchDoc = Effect.fn("watchDoc")(function* (
  { state, invocation }: RuntimeParts,
  args: readonly unknown[],
) {
  if (invocation.ended) throw endedError(invocation);
  const watch = (yield* Effect.promise(() =>
    sessionMethod(state.options.session, "watchDoc")(...args),
  )) as DocumentWatch<JsonObject> | undefined;
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
        tx.setTask({ ...current, memos: { ...current.memos, [name]: candidate } } as AnyTaskRecord);
        return candidate;
      },
      rest[1] as Context,
    );
  }) as ErasedRuntime["memo"];

const runtimeWrites = (input: RuntimeInput) => {
  const { state, invocation } = input;
  return {
    commit: (change: Parameters<ErasedRuntime["commit"]>[0], context: Context): Promise<void> =>
      state.gated(
        invocation,
        (tx: Transaction, current: ErasedRunningTask) =>
          Effect.runPromise(
            Effect.flatMap(
              Effect.promise(() => Promise.resolve(change(tx, current))),
              (next) =>
                next === undefined
                  ? Effect.void
                  : commitState(state, tx, invocation, current, next),
            ),
          ),
        context,
      ),
    memo: memo(input),
    sleep: (until: number, context: Context) =>
      Effect.runPromise(sleepUntil(input, until, context)),
    watchDoc: ((...args: readonly unknown[]) =>
      Effect.runPromise(watchDoc(input, args))) as ErasedRuntime["watchDoc"],
  };
};

export const buildRuntime = (input: RuntimeInput): ErasedRuntime => {
  const { state, invocation, phase } = input;
  const agent = agentOf(input);
  const hooks: HookRunner<Record<string, unknown>> = {
    each: (name, invoke) =>
      Effect.runPromise(eachHandler(input, agent, name, invoke as (handler: never) => void)),
  };
  const settings = state.options.settings;
  return {
    taskId: invocation.taskId as TaskId<JsonValue>,
    conversationId: invocation.conversationId,
    signal: invocation.controller.signal,
    models: state.options.models,
    agent: (context) =>
      invocation.ended
        ? Promise.reject(endedError(invocation))
        : awaitWithContext(agent(), context),
    get settings() {
      return settings();
    },
    env: (context) =>
      state.read(invocation, () => state.options.env(invocation.conversationId, context)),
    hooks: hooks as ErasedRuntime["hooks"],
    get registry() {
      return phase.snapshot();
    },
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
