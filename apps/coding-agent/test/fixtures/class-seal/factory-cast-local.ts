import { Context } from "effect";

import Local from "./local.ts";

export default class S extends Context.Service<S, { readonly n: number }>()(
  Local as unknown as string,
) {}
