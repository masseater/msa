import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Connection } from "../src/connection.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { daemon } from "./daemon.ts";

export interface RemoteEnvironments {
  readonly environment: () => { env: RemoteExecutionEnv; connection: Connection };
  readonly tempDir: () => string;
  readonly track: (connection: Connection) => void;
  readonly close: () => void;
}

export function remoteEnvironments(): RemoteEnvironments {
  const connections: Connection[] = [];
  const dirs: string[] = [];
  const tempDir = (): string => {
    const cwd = mkdtempSync(join(tmpdir(), "msa-env-remote-"));
    dirs.push(cwd);
    return cwd;
  };
  return {
    environment: () => {
      const cwd = tempDir();
      const connection = new Connection({ command: [daemon] });
      connections.push(connection);
      return { env: new RemoteExecutionEnv({ connection, id: "msa-env:test", cwd }), connection };
    },
    tempDir,
    track: (connection) => {
      connections.push(connection);
    },
    close: () => {
      for (const connection of connections) connection.close();
      for (const dir of dirs) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
      }
    },
  };
}
