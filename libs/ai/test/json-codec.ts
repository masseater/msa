import { Schema } from "effect";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const encodeJsonPretty = Schema.encodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown, { space: 2 }),
);

const jsonCodec = {
  decodeJson,
  encodeJson,
  encodeJsonPretty,
};

export default jsonCodec;
