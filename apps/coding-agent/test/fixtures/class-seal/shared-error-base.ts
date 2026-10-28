import { Data } from "effect";

import Local from "./local.ts";
import sharedBases from "./shared-bases.ts";

const written = Reflect.setPrototypeOf(sharedBases.errorBase, Local);

class D extends Data.TaggedError("D")<{ readonly message: string }> {}

export default { local: Local, subject: D, written };
