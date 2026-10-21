import { Effect } from "effect";
import { dual } from "effect/Function";

import EmptyContext from "./empty.ts";
import types from "./types.ts";
import type typesModule from "./types.types.ts";
import ContextValue from "./value.ts";

const { ABORT_SIGNAL_CONTEXT_KEY } = types;

const BACKGROUND_CONTEXT: typesModule.Context = new EmptyContext("[Context BACKGROUND_CONTEXT]");
const TODO_CONTEXT: typesModule.Context = new EmptyContext("[Context TODO_CONTEXT]");

function createContextKey<T>(description: string): typesModule.ContextKey<T> {
  return Object.freeze({ token: Symbol(description) });
}

const withContextValue: {
  <T>(
    value: T,
    parent: typesModule.Context,
  ): (key: typesModule.ContextKey<T>) => typesModule.Context;
  <T>(key: typesModule.ContextKey<T>, value: T, parent: typesModule.Context): typesModule.Context;
} = dual(
  3,
  <T>(key: typesModule.ContextKey<T>, value: T, parent: typesModule.Context): typesModule.Context =>
    new ContextValue(parent, key, value),
);

function contextWithSignal(signal: AbortSignal, context: typesModule.Context): typesModule.Context {
  const parentSignal = context.abortSignal;
  const combined = parentSignal === undefined ? signal : AbortSignal.any([parentSignal, signal]);
  return withContextValue(ABORT_SIGNAL_CONTEXT_KEY, combined, context);
}

function withoutAbortSignal(context: typesModule.Context): typesModule.Context {
  return withContextValue(ABORT_SIGNAL_CONTEXT_KEY, undefined, context);
}

function withCancel(context: typesModule.Context): {
  readonly context: typesModule.Context;
  readonly cancel: (reason?: unknown) => void;
} {
  const controller = new AbortController();
  return {
    cancel: (reason?: unknown) => controller.abort(reason),
    context: withAbortSignal(controller.signal, context),
  };
}

function awaitedWithContext<T>(promise: Promise<T>, context: typesModule.Context): Promise<T> {
  const signal = context.abortSignal;
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return Effect.runPromise(
    Effect.callback<T>((resume) => {
      const onAbort = (): void => resume(Effect.die(abortError(signal)));
      signal.addEventListener("abort", onAbort, { once: true });
      void promise.then(
        (value) => {
          resume(Effect.succeed(value));
          return undefined;
        },
        (error: unknown) => {
          resume(Effect.die(error));
        },
      );
      return Effect.sync(() => signal.removeEventListener("abort", onAbort));
    }),
  );
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("The operation was aborted", "AbortError");
}

const withAbortSignal: {
  (context: typesModule.Context): (signal: AbortSignal) => typesModule.Context;
  (signal: AbortSignal, context: typesModule.Context): typesModule.Context;
} = dual(2, contextWithSignal);

const awaitWithContext: {
  (context: typesModule.Context): <T>(promise: Promise<T>) => Promise<T>;
  <T>(promise: Promise<T>, context: typesModule.Context): Promise<T>;
} = dual(2, awaitedWithContext);

const contextModule = {
  BACKGROUND_CONTEXT,
  TODO_CONTEXT,
  awaitWithContext,
  createContextKey,
  withAbortSignal,
  withCancel,
  withContextValue,
  withoutAbortSignal,
};

export default contextModule;
