import { Schema } from "effect";

const jsonString = Schema.fromJsonString(Schema.Unknown);
const prettyJsonString = Schema.fromJsonString(Schema.Unknown, { space: 2 });

export const parseJson = Schema.decodeUnknownSync(jsonString);

export const stringifyJson = Schema.encodeSync(jsonString);

export const stringifyJsonPretty = Schema.encodeSync(prettyJsonString);
