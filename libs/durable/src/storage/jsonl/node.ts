import type { Context } from "@msa/chord";

import { NodeExecutionEnv } from "../../env/node.ts";
import { promiseTry } from "../../promise-try.ts";
import { JsonlStorage, type JsonlStorageOptions } from "./storage.ts";

export function openNodeJsonlStorage(
  directory: string,
  context: Context,
  options: JsonlStorageOptions = {},
): Promise<JsonlStorage> {
  return promiseTry(() =>
    JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: process.cwd() }), context, options),
  );
}

export { JsonlStorage, type JsonlStorageOptions } from "./storage.ts";
