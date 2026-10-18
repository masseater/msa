import { Cause, Data, Effect, Exit } from "effect";
import { dual } from "effect/Function";

export const CHORD_ERROR_CODES = [
  "aborted",
  "contract_mismatch",
  "forbidden",
  "gone",
  "invalid",
  "not_in_variant",
  "not_ready",
  "released",
  "superseded",
  "unavailable",
  "upgrade_conflict",
  "upgrade_required",
] as const;
export type ChordErrorCode = (typeof CHORD_ERROR_CODES)[number];

export type ChordErrorReason = string;

const RETRYABLE: ReadonlySet<ChordErrorCode> = new Set(["superseded", "upgrade_conflict"]);

const isChordErrorCode = (value: unknown): value is ChordErrorCode =>
  CHORD_ERROR_CODES.some((code) => code === value);

export interface ChordErrorOptions {
  cause?: unknown;
  details?: unknown;
  reason?: ChordErrorReason | undefined;
}

export class ChordError extends Data.TaggedError("ChordError")<{
  readonly code: ChordErrorCode;
  readonly reason: ChordErrorReason | undefined;
  readonly retryable: boolean;
  readonly details: unknown;
  readonly message: string;
  readonly cause?: unknown;
}> {
  constructor(code: ChordErrorCode, message: string, options?: ChordErrorOptions) {
    const reason = options?.reason;
    super({
      code,
      reason,
      retryable: RETRYABLE.has(code),
      details: options?.details,
      message: `${code}${reason === undefined || reason === "" ? "" : `/${reason}`}: ${message}`,
      cause: options?.cause,
    });
  }
}

export const isChordError: {
  (code?: ChordErrorCode): (error: unknown) => error is ChordError;
  (error: unknown, code?: ChordErrorCode): error is ChordError;
} = dual(
  (args) => args.length >= 2 || !isChordErrorCode(args[0]),
  (error: unknown, code?: ChordErrorCode): error is ChordError =>
    error instanceof ChordError && (code === undefined || error.code === code),
);

export const forbidden = (message = "forbidden"): ChordError =>
  new ChordError("forbidden", message);

export const invalid: {
  (message: string, details?: unknown): (reason: ChordErrorReason) => ChordError;
  (reason: ChordErrorReason, message: string, details?: unknown): ChordError;
} = dual(
  (args) => args.length >= 2,
  (reason: ChordErrorReason, message: string, details?: unknown): ChordError =>
    new ChordError("invalid", message, { reason, details }),
);

export const asChordError: {
  (context: string): (error: unknown) => ChordError;
  (error: unknown, context: string): ChordError;
} = dual(2, (error: unknown, context: string): ChordError =>
  error instanceof ChordError
    ? error
    : new ChordError(
        "unavailable",
        `${context}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      ),
);

export const runAll: {
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
