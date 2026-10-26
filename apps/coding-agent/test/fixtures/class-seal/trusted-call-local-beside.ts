import { Schema } from "effect";

import Local from "./local.ts";

Schema.Struct({ local: Local as never });

export default class E extends Schema.TaggedError<E>()("E", { message: Schema.String }) {}
