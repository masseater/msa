import { Schema } from "effect";

export const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const encodeJsonPretty = Schema.encodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown, { space: 2 }),
);
