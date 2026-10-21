import { Effect, Schema } from "effect";

const nextTick: Effect.Effect<void> = Effect.callback<void>((resume) => {
  process.nextTick(() => resume(Effect.void));
});

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const toJson = (value: unknown): Effect.Effect<string, Schema.SchemaError> => encodeJson(value);

const effectHelpers = {
  nextTick,
  toJson,
};

export default effectHelpers;
