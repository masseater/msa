import { Data } from "effect";

import Local from "./local.ts";
import sharedBases from "./shared-bases.ts";

class D extends Data.TaggedError("D")<{ readonly message: string }> {}

const written = Reflect.setPrototypeOf(sharedBases.errorBase, Local);

export default { local: Local, subject: D, written };
