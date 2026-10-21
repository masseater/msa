import { Effect } from "effect";

import connectionModule from "../src/connection.ts";
import type connectionTypes from "../src/connection.types.ts";
import RemoteExecutionEnv from "../src/remote-env.ts";
import daemon from "./daemon.ts";
import platform from "./platform.ts";
import type remoteEnvironmentTypes from "./remote-environment.types.ts";

const { Connection } = connectionModule;

const { makeTempDirectory, removePath } = platform;

function remoteEnvironments(): remoteEnvironmentTypes.RemoteEnvironments {
  const connections: connectionTypes.Connection[] = [];
  const dirs: string[] = [];
  const tempDir = Effect.tap(makeTempDirectory("msa-env-remote-"), (cwd) =>
    Effect.sync(() => {
      dirs.push(cwd);
    }),
  );
  return {
    close: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const connection of connections) connection.close();
          for (const dir of dirs) yield* removePath(dir);
        }),
      ),
    environment: Effect.map(tempDir, (cwd) => {
      const connection = new Connection({ command: [daemon] });
      connections.push(connection);
      return { connection, env: new RemoteExecutionEnv({ connection, cwd, id: "msa-env:test" }) };
    }),
    tempDir,
    track: (connection) => {
      connections.push(connection);
    },
  };
}

export default remoteEnvironments;
