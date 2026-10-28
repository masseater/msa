import { Data } from "effect";

import Local from "./local.ts";

class D extends Data.TaggedError("D")<{ readonly message: string }> {}

Object.setPrototypeOf(Object.getPrototypeOf(D), Local);

export default D;
