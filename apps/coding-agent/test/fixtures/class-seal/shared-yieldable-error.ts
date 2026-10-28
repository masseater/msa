import { Schema } from "effect";

import Local from "./local.ts";
import sharedBases from "./shared-bases.ts";

Object.setPrototypeOf(sharedBases.yieldableError, Local);

class E extends Schema.TaggedError<E>()("E", { message: Schema.String }) {}

export default E;
