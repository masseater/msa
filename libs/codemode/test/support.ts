import { Effect, Schema } from "effect";

const abortController = (): AbortController => new AbortController();

const hang = (): Promise<never> => Effect.runPromise(Effect.never);

const UnknownJson = Schema.fromJsonString(Schema.Unknown);

const toJson = (value: unknown): Effect.Effect<string> =>
  Schema.encodeEffect(UnknownJson)(value).pipe(Effect.orDie);

const fromJson = (text: string): Effect.Effect<unknown> =>
  Schema.decodeEffect(UnknownJson)(text).pipe(Effect.orDie);

const support = {
  abortController,
  fromJson,
  hang,
  toJson,
};

export default support;
