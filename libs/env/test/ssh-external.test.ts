import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { getOrThrow } from "@msa/durable/env";
import { registerEnvConformance } from "@msa/durable/testing";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import envModule from "../src/index.ts";
import type envTypes from "../src/index.types.ts";
import environment from "./environment.ts";
import externalSsh from "./external-ssh.ts";
import tempDir from "./temp-dir.ts";

const { RemoteExecutionEnv, nodePlatform } = envModule;

const { optionalEnv, windows } = environment;
const { closeExternal, connectExternal, host } = externalSsh;
const { gitBash } = tempDir;

afterAll(closeExternal);

const defaultShell = Effect.gen(function* () {
  const { connection, remote } = yield* Effect.promise(connectExternal);
  const info = yield* Effect.promise(() => connection.info());
  expect(nodePlatform(info).platform).toBe(process.platform);
  if (windows) expect(remote.shell).toBe(optionalEnv("MSA_ENV_SSH_SHELL") ?? "cmd");
});

describe.skipIf(host === undefined)("SSH to this machine's server", () => {
  it(
    "reaches the remote system through its default shell",
    () => Effect.runPromise(defaultShell),
    120_000,
  );
});

const withExternalEnv = (use: (env: envTypes.RemoteExecutionEnv) => Promise<void>): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { connection } = yield* Effect.promise(connectExternal);
      const info = yield* Effect.promise(() => connection.info());
      const home = new RemoteExecutionEnv({ connection, cwd: info.home, id: "msa-env:external" });
      const cwd = getOrThrow(
        yield* Effect.promise(() => home.createTempDir("msa-env-conformance-", BACKGROUND_CONTEXT)),
      );
      yield* Effect.promise(() =>
        use(
          new RemoteExecutionEnv({
            connection,
            cwd,
            id: "msa-env:external",
            watch: { pollIntervalMs: 100 },
          }),
        ),
      ).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            home.remove(cwd, { force: true, recursive: true }, BACKGROUND_CONTEXT),
          ),
        ),
      );
    }),
  );

if (host !== undefined) {
  registerEnvConformance(
    { describe, expect, it },
    "RemoteExecutionEnv over SSH",
    withExternalEnv,
    windows
      ? { listFiles: true, shell: [gitBash(optionalEnv("ProgramFiles")), "-c"], symlinks: false }
      : { listFiles: true },
  );
}
