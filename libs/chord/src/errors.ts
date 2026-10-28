import { Cause, Effect, Exit, Schema } from "effect";
import { dual } from "effect/Function";

import CHORD_ERROR_CODES from "./chord-error-codes.ts";
import ChordError from "./chord-error.ts";
import type errorsTypes from "./errors.types.ts";

const isChordErrorCode = (value: unknown): value is errorsTypes.ChordErrorCode =>
  CHORD_ERROR_CODES.some((code) => code === value);

const isChordError: {
  (code?: errorsTypes.ChordErrorCode): (error: unknown) => error is ChordError;
  (error: unknown, code?: errorsTypes.ChordErrorCode): error is ChordError;
} = dual(
  (args) => args.length >= 2 || !isChordErrorCode(args[0]),
  (error: unknown, code?: errorsTypes.ChordErrorCode): error is ChordError =>
    Schema.is(ChordError)(error) && (code === undefined || error.code === code),
);

const forbidden = (message = "forbidden"): ChordError => ChordError.create("forbidden", message);

const invalid: {
  (message: string, details?: unknown): (reason: errorsTypes.ChordErrorReason) => ChordError;
  (reason: errorsTypes.ChordErrorReason, message: string, details?: unknown): ChordError;
} = dual(
  (args) => args.length >= 2,
  (reason: errorsTypes.ChordErrorReason, message: string, details?: unknown): ChordError =>
    ChordError.create("invalid", message, { details, reason }),
);

const asChordError: {
  (context: string): (error: unknown) => ChordError;
  (error: unknown, context: string): ChordError;
} = dual(2, (error: unknown, context: string): ChordError =>
  Schema.is(ChordError)(error)
    ? error
    : ChordError.create(
        "unavailable",
        `${context}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      ),
);

const runAll: {
  (message: string): (steps: readonly Effect.Effect<unknown>[]) => Effect.Effect<void>;
  (steps: readonly Effect.Effect<unknown>[], message: string): Effect.Effect<void>;
} = dual(2, (steps: readonly Effect.Effect<unknown>[], message: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const errors: unknown[] = [];
    for (const step of steps) {
      const exit = yield* Effect.exit(step);
      if (Exit.isFailure(exit)) errors.push(Cause.squash(exit.cause));
    }
    if (errors.length === 1) return yield* Effect.die(errors[0]);
    if (errors.length > 1) return yield* Effect.die(new AggregateError(errors, message));
  }),
);

const errorsModule = {
  CHORD_ERROR_CODES,
  ChordError,
  asChordError,
  forbidden,
  invalid,
  isChordError,
  runAll,
};

export default errorsModule;
