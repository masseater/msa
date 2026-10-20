import type connectionTypes from "./connection.types.ts";
import type remoteEnv from "./remote-env.ts";
import type watchTypes from "./watch.types.ts";

declare namespace remoteEnvTypes {
  interface RemoteExecutionEnvOptions {
    connection: connectionTypes.Connection;
    id: string;
    cwd: string;
    shellPath?: string;
    shellEnv?: Record<string, string>;
    watch?: watchTypes.RemoteWatchOptions;
  }

  type RemoteExecutionEnv = (typeof remoteEnv.RemoteExecutionEnv)["prototype"];
}

export type { remoteEnvTypes as default };
