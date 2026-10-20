import type { Context } from "@msa/chord";
import type envTypes from "@msa/durable/env.types";
import nodeModule from "@msa/durable/env/node";
import { Effect } from "effect";

import type connectionTypes from "./connection.types.ts";
import listFilesModule from "./list-files.ts";
import type listFilesTypes from "./list-files.types.ts";

const { listFilesEffect } = listFilesModule;

export default class LocalExecutionEnv
  extends nodeModule.NodeExecutionEnv
  implements envTypes.ExecutionEnv
{
  readonly #connection: connectionTypes.Connection;

  constructor(options: listFilesTypes.LocalExecutionEnvOptions) {
    const { connection, ...node } = options;
    super(node);
    this.#connection = connection;
  }

  listFiles(
    path: string,
    options: envTypes.ListFilesOptions | undefined,
    context: Context,
  ): Promise<envTypes.Result<envTypes.FileListing, envTypes.FileError>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const resolved = yield* Effect.promise(() => this.absolutePath(path, context));
        if (!resolved.ok) return resolved;
        return yield* listFilesEffect(this.#connection, resolved.value, options, context);
      }),
    );
  }
}
