import { registerEnvConformance } from "@msa/durable/testing";
import { afterAll, describe, expect, it } from "vite-plus/test";

import connectionModule from "../src/connection.ts";
import listFilesModule from "../src/list-files.ts";
import remoteEnv from "../src/remote-env.ts";
import daemon from "./daemon.ts";
import environment from "./environment.ts";
import tempDir from "./temp-dir.ts";

const { Connection } = connectionModule;
const { RemoteExecutionEnv } = remoteEnv;
const { LocalExecutionEnv } = listFilesModule;

const { optionalEnv, windows } = environment;
const { gitBash, withTempDir } = tempDir;

const connection = new Connection({ command: [daemon] });
afterAll(() => {
  connection.close();
});

const options = windows
  ? { listFiles: true, shell: [gitBash(optionalEnv("ProgramFiles")), "-c"], symlinks: false }
  : { listFiles: true };

registerEnvConformance(
  { describe, expect, it },
  "RemoteExecutionEnv over a pipe",
  (use) =>
    withTempDir({
      prefix: "msa-env-conformance-",
      use: (cwd) =>
        use(
          new RemoteExecutionEnv({
            connection,
            cwd,
            id: "msa-env:test",
            watch: { pollIntervalMs: 100 },
          }),
        ),
    }),
  options,
);

registerEnvConformance(
  { describe, expect, it },
  "LocalExecutionEnv",
  (use) =>
    withTempDir({
      prefix: "msa-env-local-conformance-",
      use: (cwd) => use(new LocalExecutionEnv({ connection, cwd, watch: { pollIntervalMs: 100 } })),
    }),
  options,
);
