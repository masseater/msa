import type { Context } from "@msa/chord";

import { type FileError, type Result } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { delay } from "./tools-support.ts";

export class SlowReadExecutionEnv extends NodeExecutionEnv {
  override async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    await delay(20);
    return super.readTextFile(path, context);
  }
}
