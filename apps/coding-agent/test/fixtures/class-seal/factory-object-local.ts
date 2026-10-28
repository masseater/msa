import { Data } from "effect";

import Local from "./local.ts";

export default class D extends Data.TaggedError({ base: Local } as never)<{
  readonly message: string;
}> {}
