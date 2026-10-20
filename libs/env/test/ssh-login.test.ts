import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { getOrThrow } from "@msa/durable/env";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import remoteEnv from "../src/remote-env.ts";
import platform from "./platform.ts";
import sshdModule from "./sshd.ts";
import type sshdTypes from "./sshd.types.ts";

const { RemoteExecutionEnv } = remoteEnv;

const { localPath, writeText } = platform;
const { connectTo, posixAccountShell, sshd, useSshd } = sshdModule;

const context = BACKGROUND_CONTEXT;

const loginOutput = (server: sshdTypes.SshServer, loginShell: boolean): Effect.Effect<string> =>
  Effect.acquireUseRelease(
    Effect.promise(() => connectTo({ loginShell, server })),
    ({ connection }) =>
      Effect.gen(function* () {
        const env = new RemoteExecutionEnv({ connection, cwd: server.home, id: "msa-env:test" });
        const output: string[] = [];
        const onOutput = (text: string): void => {
          output.push(text);
        };
        const result = yield* Effect.promise(() =>
          env.exec(["sh", "-c", 'printf "%s" "$MSA_ENV_LOGIN"'], { onOutput }, context),
        );
        getOrThrow(result);
        return output.join("");
      }),
    ({ connection }) =>
      Effect.sync(() => {
        connection.close();
      }),
  );

const loginShellOnlyWhenAsked = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const name of [".profile", ".zprofile"]) {
      yield* writeText({
        path: localPath.join(server.home, name),
        text: "export MSA_ENV_LOGIN=yes\n",
      });
    }
    expect(yield* loginOutput(server, false)).toBe("");
    expect(yield* loginOutput(server, true)).toBe("yes");
  });

describe.skipIf(sshd === undefined)("SSH login shell", () => {
  const server = useSshd(true);
  it.skipIf(!posixAccountShell)(
    "starts the daemon through the login shell only when asked",
    () => Effect.runPromise(loginShellOnlyWhenAsked(server())),
    60_000,
  );
});
