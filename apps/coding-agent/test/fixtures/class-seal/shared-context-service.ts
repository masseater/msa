import { Context } from "effect";

import Local from "./local.ts";
import sharedBases from "./shared-bases.ts";

const written = Reflect.setPrototypeOf(sharedBases.serviceBase, Local);

class S extends Context.Service<S, { readonly n: number }>()(
  "@msa/coding-agent/test/fixtures/class-seal/shared-context-service/S",
) {}

export default { local: Local, subject: S, written };
