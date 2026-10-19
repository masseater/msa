import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { type FileError, type Result } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { awaited } from "./effect-support.ts";
import { delay } from "./tools-support.ts";

export class SlowReadExecutionEnv extends NodeExecutionEnv {
  override readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const superReadTextFile = super.readTextFile.bind(this);
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* awaited(delay(20));
        return yield* awaited(superReadTextFile(path, context));
      }),
    );
  }
}
