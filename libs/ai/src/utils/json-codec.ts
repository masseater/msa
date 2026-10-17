import { Effect, Schema } from "effect";

const jsonString = Schema.fromJsonString(Schema.Unknown);
const prettyJsonString = Schema.fromJsonString(Schema.Unknown, { space: 2 });

const decode = Schema.decodeUnknownEffect(jsonString);
const encode = Schema.encodeUnknownEffect(jsonString);
const encodePretty = Schema.encodeUnknownEffect(prettyJsonString);

export const decodeJson = (text: string): Effect.Effect<unknown, Schema.SchemaError> =>
  decode(text);

export const decodeJsonOrDie = (text: string): Effect.Effect<unknown> => Effect.orDie(decode(text));

export const encodeJson = (value: unknown): Effect.Effect<string> => Effect.orDie(encode(value));

export const encodeJsonPretty = (value: unknown): Effect.Effect<string> =>
  Effect.orDie(encodePretty(value));

export const encodeJsonSync = (value: unknown): string => Effect.runSync(encodeJson(value));

export const decodeJsonSync = (text: string): unknown => Effect.runSync(decodeJsonOrDie(text));
