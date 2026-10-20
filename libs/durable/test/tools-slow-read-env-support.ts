import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import type envTypes from "../src/env/index.types.ts";
import node from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import toolsSupport from "./tools-support.ts";
const { awaited } = effectSupport;
const { delay } = toolsSupport;

class SlowReadExecutionEnv extends node.NodeExecutionEnv {
  override readTextFile(
    path: string,
    context: chordTypes.Context,
  ): Promise<envTypes.Result<string, envTypes.FileError>> {
    const superReadTextFile = super.readTextFile.bind(this);
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* awaited(delay(20));
        return yield* awaited(superReadTextFile(path, context));
      }),
    );
  }
}

export default SlowReadExecutionEnv;
