import { Data, Effect, Function } from "effect";

import { formatThrownValue } from "./diagnostics.ts";

export type ModelsErrorCode =
  | "model_source"
  | "model_validation"
  | "provider"
  | "stream"
  | "auth"
  | "oauth";

const withCauseDetail = (message: string, cause: unknown): string => {
  if (cause === undefined || cause === null) return message;
  const detail = formatThrownValue(cause).trim();
  if (detail === "" || message.includes(detail)) return message;
  return `${message}: ${detail}`;
};

export class ModelsError extends Data.TaggedError("ModelsError")<{
  readonly code: ModelsErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}> {
  constructor(code: ModelsErrorCode, message: string, options?: { cause?: unknown }) {
    super({
      code,
      message: withCauseDetail(message, options?.cause),
      ...(options === undefined || !("cause" in options) ? {} : { cause: options.cause }),
    });
  }
}

export interface ModelsErrorSpec {
  readonly code: ModelsErrorCode;
  readonly message: string;
}

export const promiseOrModelsError: {
  (spec: ModelsErrorSpec): <A>(run: () => Promise<A>) => Effect.Effect<A>;
  <A>(run: () => Promise<A>, spec: ModelsErrorSpec): Effect.Effect<A>;
} = Function.dual(2, <A>(run: () => Promise<A>, spec: ModelsErrorSpec): Effect.Effect<A> =>
  Effect.promise(() => run()).pipe(
    Effect.catchDefect((cause) => Effect.die(new ModelsError(spec.code, spec.message, { cause }))),
  ),
);
