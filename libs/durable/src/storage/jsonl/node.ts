import type { Context } from "@msa/chord";

import { NodeExecutionEnv } from "../../env/node.ts";
import { promiseTry } from "../../promise-try.ts";
import { JsonlStorage, type JsonlStorageOptions } from "./storage.ts";

/**
 * Open or create a JSONL storage directory using the local Node filesystem.
 * @param {string} directory - The storage directory.
 * @param {Context} context - The caller's context.
 * @param {JsonlStorageOptions} options - The storage options.
 * @returns {Promise<JsonlStorage>} The storage.
 */
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
