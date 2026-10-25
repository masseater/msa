import { Schema } from "effect";

const Json = Schema.fromJsonString(Schema.Unknown);
const IndentedJson = Schema.fromJsonString(Schema.Unknown, { space: 2 });

const json = {
  IndentedJson,
  indent: Number.parseInt(2),
  Json,
};

export default json;
