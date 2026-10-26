import { Data } from "effect";

import holder from "./holder.ts";

holder.swap();

export default class D extends Data.TaggedError(holder.current() as never)<{
  readonly message: string;
}> {}
