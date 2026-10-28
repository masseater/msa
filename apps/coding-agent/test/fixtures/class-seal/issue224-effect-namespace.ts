import { Data } from "effect";

import Local from "./local.ts";

const box = { data: Data };
(box.data as { TaggedError: unknown }).TaggedError = () => Local;

export default class D extends Data.TaggedError("D")<{ readonly message: string }> {}
