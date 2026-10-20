import { Effect } from "effect";

import McpForeignError from "./mcp-foreign-error.ts";
import jsonrpcModule from "./protocol/jsonrpc.ts";

const { toError } = jsonrpcModule;

const foreign = (cause: unknown): McpForeignError =>
  new McpForeignError({ cause, message: toError(cause).message });

const fromPromise = <A>(evaluate: () => PromiseLike<A> | A): Effect.Effect<A, McpForeignError> =>
  Effect.tryPromise({ catch: foreign, try: () => Promise.resolve(evaluate()) });

const fromSync = <A>(evaluate: () => A): Effect.Effect<A, McpForeignError> =>
  Effect.try({ catch: foreign, try: evaluate });

const unwrapForeign = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, McpForeignError>, R> =>
  effect.pipe(
    Effect.catch((error) =>
      error instanceof McpForeignError
        ? Effect.die(error.cause)
        : Effect.fail(error as Exclude<E, McpForeignError>),
    ),
  );

const toPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(unwrapForeign(effect));

const foreignModule = {
  McpForeignError,
  foreign,
  fromPromise,
  fromSync,
  toPromise,
  unwrapForeign,
};

export default foreignModule;
