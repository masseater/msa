import { Schema } from "effect";

import Local from "./local.ts";

const registry = new Map<string, unknown>([["base", Local]]);

export default class E extends Schema.TaggedError<E>()("E", {
  local: Schema.instanceOf(registry.get("base") as typeof Local),
}) {}
