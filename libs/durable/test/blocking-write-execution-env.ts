import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import node from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import toolsSupport from "./tools-support.ts";
import type toolsSupportTypes from "./tools-support.types.ts";
const { awaited } = effectSupport;
const { deferred } = toolsSupport;

export default class BlockingWriteExecutionEnv extends node.NodeExecutionEnv {
  readonly firstWriteStarted = deferred();
  readonly finishFirstWrite = deferred();
  secondWriteStarted = false;

  override writeFile(
    path: string,
    content: string | Uint8Array,
    context: chordTypes.Context,
  ): Promise<toolsSupportTypes.Result<void, toolsSupportTypes.FileError>> {
    const superWriteFile = super.writeFile.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (content === "first\n") {
          this.firstWriteStarted.resolve();
          yield* awaited(this.finishFirstWrite.promise);
        } else if (content === "second\n") {
          this.secondWriteStarted = true;
        }
        return yield* awaited(superWriteFile(path, content, context));
      }),
    );
  }
}
