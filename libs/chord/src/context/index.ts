import { Effect } from "effect";
import { dual } from "effect/Function";

import { EmptyContext } from "./empty.ts";
import { ABORT_SIGNAL_CONTEXT_KEY, type Context, type ContextKey } from "./types.ts";
import { ContextValue } from "./value.ts";

export type { Context, ContextKey } from "./types.ts";

export const BACKGROUND_CONTEXT: Context = new EmptyContext("[Context BACKGROUND_CONTEXT]");
export const TODO_CONTEXT: Context = new EmptyContext("[Context TODO_CONTEXT]");

export function createContextKey<T>(description: string): ContextKey<T> {
  return Object.freeze({ token: Symbol(description) });
}

export const withContextValue: {
  <T>(value: T, parent: Context): (key: ContextKey<T>) => Context;
  <T>(key: ContextKey<T>, value: T, parent: Context): Context;
} = dual(
  3,
  <T>(key: ContextKey<T>, value: T, parent: Context): Context =>
    new ContextValue(parent, key, value),
);

function contextWithSignal(signal: AbortSignal, context: Context): Context {
  const parentSignal = context.abortSignal;
  const combined = parentSignal === undefined ? signal : AbortSignal.any([parentSignal, signal]);
  return withContextValue(ABORT_SIGNAL_CONTEXT_KEY, combined, context);
}

export function withoutAbortSignal(context: Context): Context {
  return withContextValue(ABORT_SIGNAL_CONTEXT_KEY, undefined, context);
}

export function withCancel(context: Context): {
  readonly context: Context;
  readonly cancel: (reason?: unknown) => void;
} {
  const controller = new AbortController();
  return {
    context: withAbortSignal(controller.signal, context),
    cancel: (reason?: unknown) => controller.abort(reason),
  };
}

function awaitedWithContext<T>(promise: Promise<T>, context: Context): Promise<T> {
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

export const withAbortSignal: {
  (context: Context): (signal: AbortSignal) => Context;
  (signal: AbortSignal, context: Context): Context;
} = dual(2, contextWithSignal);

export const awaitWithContext: {
  (context: Context): <T>(promise: Promise<T>) => Promise<T>;
  <T>(promise: Promise<T>, context: Context): Promise<T>;
} = dual(2, awaitedWithContext);
