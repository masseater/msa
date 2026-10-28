import { Schema } from "effect";

import Local from "./local.ts";

export default class E extends Schema.TaggedError<E>()("E", {
  local: Schema.optionalKey(Schema.instanceOf(Local)),
}) {}
