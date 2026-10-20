import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import nodeModule from "../../env/node.ts";
import JsonlStorage from "./storage.ts";
import type storageTypes from "./storage.types.ts";

const { NodeExecutionEnv } = nodeModule;

const openNodeJsonlStorage: {
  (
    context: Context,
    options?: storageTypes.JsonlStorageOptions,
  ): (directory: string) => Promise<storageTypes.JsonlStorage>;
  (
    directory: string,
    context: Context,
    options?: storageTypes.JsonlStorageOptions,
  ): Promise<storageTypes.JsonlStorage>;
} = Function.dual(
  (args: IArguments) => typeof args[0] === "string",
  (
    directory: string,
    context: Context,
    options: storageTypes.JsonlStorageOptions = {},
  ): Promise<storageTypes.JsonlStorage> =>
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

const node = {
  JsonlStorage: JsonlStorage,
  openNodeJsonlStorage,
};

export default node;
