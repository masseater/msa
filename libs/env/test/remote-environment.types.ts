import type { Effect } from "effect";

import type { Connection } from "../src/connection.ts";
import type { RemoteExecutionEnv } from "../src/remote-env.ts";

declare namespace remoteEnvironmentTypes {
  interface RemoteEnvironments {
    readonly environment: Effect.Effect<{ env: RemoteExecutionEnv; connection: Connection }>;
    readonly tempDir: Effect.Effect<string>;
    readonly track: (connection: Connection) => void;
    readonly close: () => Promise<void>;
  }
}

export type { remoteEnvironmentTypes as default };
