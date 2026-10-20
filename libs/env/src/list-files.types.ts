import type { NodeExecutionEnv } from "@msa/durable/env/node";

import type connectionTypes from "./connection.types.ts";
import type listFilesModule from "./list-files.ts";

declare namespace listFilesTypes {
  type LocalExecutionEnvOptions = ConstructorParameters<typeof NodeExecutionEnv>[0] & {
    connection: connectionTypes.Connection;
  };

  type LocalExecutionEnv = (typeof listFilesModule.LocalExecutionEnv)["prototype"];
}

export type { listFilesTypes as default };
