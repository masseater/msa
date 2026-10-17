import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { NodeExecutionEnv } from "../../env/node.ts";
import { JsonlStorage, type JsonlStorageOptions } from "./storage.ts";

export const openNodeJsonlStorage: {
  (context: Context, options?: JsonlStorageOptions): (directory: string) => Promise<JsonlStorage>;
  (directory: string, context: Context, options?: JsonlStorageOptions): Promise<JsonlStorage>;
} = Function.dual(
  (args: IArguments) => typeof args[0] === "string",
  (directory: string, context: Context, options: JsonlStorageOptions = {}): Promise<JsonlStorage> =>
    Effect.runPromise(
      Effect.promise(() =>
        JsonlStorage.open(
          directory,
          new NodeExecutionEnv({ cwd: process.cwd() }),
          context,
          options,
        ),
      ),
    ),
);

export { JsonlStorage, type JsonlStorageOptions } from "./storage.ts";
