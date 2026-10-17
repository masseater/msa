import type { Context } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";

import { type FileError, type Result } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { deferred } from "./tools-support.ts";

export class BlockingEditExecutionEnv extends NodeExecutionEnv {
  readonly firstEditWriteStarted = deferred();
  readonly finishFirstEditWrite = deferred();
  firstEditWriteSettled = false;
  secondEditWriteStarted = false;

  override async writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    if (content === "ALPHA\nbeta\n") {
      this.firstEditWriteStarted.resolve();
      await this.finishFirstEditWrite.promise;
      const result = await super.writeFile(path, content, BACKGROUND_CONTEXT);
      this.firstEditWriteSettled = true;
      return result;
    }
    if (content === "ALPHA\nBETA\n" || content === "alpha\nBETA\n") {
      this.secondEditWriteStarted = true;
    }
    return super.writeFile(path, content, context);
  }
}
