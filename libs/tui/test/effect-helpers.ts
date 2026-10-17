import { Effect, Schema } from "effect";

export const nextTick: Effect.Effect<void> = Effect.callback<void>((resume) => {
  process.nextTick(() => resume(Effect.void));
});

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const toJson = (value: unknown): Effect.Effect<string, Schema.SchemaError> =>
  encodeJson(value);
