import { Cause, Effect, Predicate } from "effect";
import { dual } from "effect/Function";

import ForeignError from "./foreign-error.ts";
import type foreignErrorTypes from "./foreign-error.types.ts";
import ToolFailure from "./tool-failure.ts";
import type toolFailureTypes from "./tool-failure.types.ts";

const abortedBy =
  (signal: AbortSignal | undefined) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | toolFailureTypes.ToolFailure, R> =>
    signal === undefined
      ? effect
      : Effect.raceFirst(
          effect,
          Effect.callback<never, toolFailureTypes.ToolFailure>((resume, abortSignal) => {
            const fail = (): void =>
              resume(Effect.fail(new ToolFailure({ message: "Operation aborted" })));
            if (signal.aborted) fail();
            else signal.addEventListener("abort", fail, { once: true, signal: abortSignal });
          }),
        );

const isMissingPath = (error: unknown): boolean => {
  if (!Predicate.hasProperty(error, "reason")) return false;
  const { reason } = error;
  if (Predicate.isTagged(reason, "NotFound")) return true;
  const cause = Predicate.hasProperty(reason, "cause") ? reason.cause : undefined;
  return (
    Predicate.hasProperty(cause, "code") && (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  );
};

const rethrowCause = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.die(
        Predicate.hasProperty(error, "cause") && error.cause !== undefined ? error.cause : error,
      ),
    ),
  );

const fromMaybePromise = <A>(evaluate: () => Promise<A> | A): Effect.Effect<A> =>
  Effect.promise(() => Promise.resolve(evaluate()));

const nonEmptyOr: {
  (fallback: string): (value: string | undefined) => string;
  (value: string | undefined, fallback: string): string;
} = dual(2, (value: string | undefined, fallback: string): string =>
  value === undefined || value === "" ? fallback : value,
);

const fromPromise = <A>(
  evaluate: (signal: AbortSignal) => PromiseLike<A> | A,
): Effect.Effect<A, foreignErrorTypes.ForeignError> =>
  Effect.tryPromise({
    catch: (cause) =>
      new ForeignError({ cause, message: cause instanceof Error ? cause.message : String(cause) }),
    try: (signal) => Promise.resolve(evaluate(signal)),
  });

const unwrapForeign = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, foreignErrorTypes.ForeignError>, R> =>
  effect.pipe(
    Effect.catch((error) =>
      error instanceof ForeignError
        ? Effect.die(error.cause)
        : Effect.fail(error as Exclude<E, foreignErrorTypes.ForeignError>),
    ),
  );

const errorFromCause = (cause: Cause.Cause<unknown>): unknown => {
  const squashed = Cause.squash(cause);
  return squashed instanceof ForeignError ? squashed.cause : squashed;
};

const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const error = errorFromCause(cause);
  return error instanceof Error ? error.message : String(error);
};

const effectInterop = {
  abortedBy,
  causeMessage,
  errorFromCause,
  fromMaybePromise,
  fromPromise,
  isMissingPath,
  nonEmptyOr,
  rethrowCause,
  unwrapForeign,
};

export default effectInterop;
