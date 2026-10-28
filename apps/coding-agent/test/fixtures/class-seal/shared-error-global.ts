import { Data } from "effect";

import Local from "./local.ts";

const written = Reflect.setPrototypeOf(Error, Local);

class D extends Data.TaggedError("D")<{ readonly message: string }> {}

export default { local: Local, subject: D, written };
