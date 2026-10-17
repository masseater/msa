import { Data, Effect } from "effect";

import { toError } from "./protocol/jsonrpc.ts";

export class McpForeignError extends Data.TaggedError("McpForeignError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const foreign = (cause: unknown): McpForeignError =>
  new McpForeignError({ cause, message: toError(cause).message });

export const fromPromise = <A>(
  evaluate: () => PromiseLike<A> | A,
): Effect.Effect<A, McpForeignError> =>
  Effect.tryPromise({ try: () => Promise.resolve(evaluate()), catch: foreign });

export const fromSync = <A>(evaluate: () => A): Effect.Effect<A, McpForeignError> =>
  Effect.try({ try: evaluate, catch: foreign });

export const unwrapForeign = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, McpForeignError>, R> =>
  effect.pipe(
    Effect.catch((error) =>
      error instanceof McpForeignError
        ? Effect.die(error.cause)
        : Effect.fail(error as Exclude<E, McpForeignError>),
    ),
  );

export const toPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(unwrapForeign(effect));
