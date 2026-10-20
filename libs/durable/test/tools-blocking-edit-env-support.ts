import type { Context } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";

import type envTypes from "../src/env/index.types.ts";
import node from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import toolsSupport from "./tools-support.ts";

const { NodeExecutionEnv } = node;

const { awaited } = effectSupport;
const { deferred } = toolsSupport;

class BlockingEditExecutionEnv extends NodeExecutionEnv {
  readonly firstEditWriteStarted = deferred();
  readonly finishFirstEditWrite = deferred();
  firstEditWriteSettled = false;
  secondEditWriteStarted = false;

  override writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<envTypes.Result<void, envTypes.FileError>> {
    const superWriteFile = super.writeFile.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (content === "ALPHA\nbeta\n") {
          this.firstEditWriteStarted.resolve();
          yield* awaited(this.finishFirstEditWrite.promise);
          const result = yield* awaited(superWriteFile(path, content, BACKGROUND_CONTEXT));
          this.firstEditWriteSettled = true;
          return result;
        }
        if (content === "ALPHA\nBETA\n" || content === "alpha\nBETA\n") {
          this.secondEditWriteStarted = true;
        }
        return yield* awaited(superWriteFile(path, content, context));
      }),
    );
  }
}

export default BlockingEditExecutionEnv;
