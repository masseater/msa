import { Effect, Schema } from "effect";

export const abortController = (): AbortController => new AbortController();

export const hang = (): Promise<never> => Effect.runPromise(Effect.never);

const UnknownJson = Schema.fromJsonString(Schema.Unknown);

export const toJson = (value: unknown): Effect.Effect<string> =>
  Schema.encodeEffect(UnknownJson)(value).pipe(Effect.orDie);

export const fromJson = (text: string): Effect.Effect<unknown> =>
  Schema.decodeEffect(UnknownJson)(text).pipe(Effect.orDie);
