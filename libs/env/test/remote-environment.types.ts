import type { Effect } from "effect";

import type connectionTypes from "../src/connection.types.ts";
import type remoteEnvTypes from "../src/remote-env.types.ts";

declare namespace remoteEnvironmentTypes {
  interface RemoteEnvironments {
    readonly environment: Effect.Effect<{
      env: remoteEnvTypes.RemoteExecutionEnv;
      connection: connectionTypes.Connection;
    }>;
    readonly tempDir: Effect.Effect<string>;
    readonly track: (connection: connectionTypes.Connection) => void;
    readonly close: () => Promise<void>;
  }
}

export type { remoteEnvironmentTypes as default };
