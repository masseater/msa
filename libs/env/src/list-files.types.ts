import type node from "@msa/durable/env/node";

import type connectionTypes from "./connection.types.ts";
import type LocalExecutionEnvClass from "./local-execution-env.ts";

declare namespace listFilesTypes {
  type LocalExecutionEnvOptions = ConstructorParameters<typeof node.NodeExecutionEnv>[0] & {
    connection: connectionTypes.Connection;
  };

  type LocalExecutionEnv = LocalExecutionEnvClass;
}

export type { listFilesTypes as default };
