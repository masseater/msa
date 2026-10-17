import { registerEnvConformance } from "@msa/durable/testing";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { Connection } from "../src/connection.ts";
import { LocalExecutionEnv } from "../src/list-files.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { daemon } from "./daemon.ts";
import { optionalEnv, windows } from "./environment.ts";
import { gitBash, withTempDir } from "./temp-dir.ts";

const connection = new Connection({ command: [daemon] });
afterAll(() => {
  connection.close();
});

const options = windows
  ? { shell: [gitBash(optionalEnv("ProgramFiles")), "-c"], symlinks: false, listFiles: true }
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
            id: "msa-env:test",
            cwd,
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
