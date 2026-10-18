import { Effect } from "effect";

import { Connection } from "../src/connection.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { daemon } from "./daemon.ts";
import { makeTempDirectory, removePath } from "./platform.ts";

export interface RemoteEnvironments {
  readonly environment: Effect.Effect<{ env: RemoteExecutionEnv; connection: Connection }>;
  readonly tempDir: Effect.Effect<string>;
  readonly track: (connection: Connection) => void;
  readonly close: () => Promise<void>;
}

export function remoteEnvironments(): RemoteEnvironments {
  const connections: Connection[] = [];
  const dirs: string[] = [];
  const tempDir = Effect.tap(makeTempDirectory("msa-env-remote-"), (cwd) =>
    Effect.sync(() => {
      dirs.push(cwd);
    }),
  );
  return {
    environment: Effect.map(tempDir, (cwd) => {
      const connection = new Connection({ command: [daemon] });
      connections.push(connection);
      return { env: new RemoteExecutionEnv({ connection, id: "msa-env:test", cwd }), connection };
    }),
    tempDir,
    track: (connection) => {
      connections.push(connection);
    },
    close: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const connection of connections) connection.close();
          for (const dir of dirs) yield* removePath(dir);
        }),
      ),
  };
}
