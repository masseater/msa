import { Schema } from "effect";

const Json = Schema.fromJsonString(Schema.Unknown);
const IndentedJson = Schema.fromJsonString(Schema.Unknown, { space: 2 });

export { IndentedJson, Json };
