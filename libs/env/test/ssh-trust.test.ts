import contextModule from "@msa/chord/context";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import envModule from "../src/index.ts";
import RemoteExecutionEnv from "../src/remote-env.ts";
import daemon from "./daemon.ts";
import platform from "./platform.ts";
import sshdModule from "./sshd.ts";
import type sshdTypes from "./sshd.types.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const {
  HostKeyChangedError,
  acceptHostKey,
  connectSsh,
  forgetHostKey,
  scanHostKey,
  sshConnection,
} = envModule;

const { localPath, readText, writeText } = platform;
const { keygen, publicKey, sshd, useSshd } = sshdModule;

const context = BACKGROUND_CONTEXT;

const lazyStart = (server: sshdTypes.SshServer): Effect.Effect<void> => {
  const lazyTarget = {
    ...server.target,
    knownHostsFile: localPath.join(server.root, "lazy_known_hosts"),
  };
  const { connection, remote } = sshConnection({ ...lazyTarget, binary: daemon });
  return Effect.gen(function* () {
    expect(remote()).toBeUndefined();
    const env = new RemoteExecutionEnv({ connection, cwd: server.home, id: "msa-env:test" });
    const read = yield* Effect.promise(() => env.readTextFile("missing.txt", context));
    expect(read.ok ? "ok" : read.error.message).toMatch(/not trusted/u);
    const command = yield* Effect.promise(() =>
      env.exec(["sh", "-c", "exit 0"], undefined, context),
    );
    expect(command.ok ? "ok" : command.error.code).toBe("spawn_error");
    const scanned = yield* Effect.promise(() => scanHostKey(lazyTarget));
    yield* Effect.promise(() => acceptHostKey(lazyTarget, scanned.lines));
    const accepted = yield* Effect.promise(() =>
      env.exec(["sh", "-c", "exit 0"], undefined, context),
    );
    expect(accepted.ok ? accepted.value.exitCode : accepted.error.message).toBe(0);
    expect(remote()?.home).toBe(server.home);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        connection.close();
      }),
    ),
  );
};

const acceptsOnlyAlias = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    const knownHosts = localPath.join(server.root, "accept_known_hosts");
    const scoped = { ...server.target, knownHostsFile: knownHosts };
    const key = (name: string): Effect.Effect<string> => {
      const file = localPath.join(server.root, name);
      return Effect.andThen(keygen(file), publicKey(file));
    };
    const first = yield* key("accept_first");
    const second = yield* key("accept_second");
    yield* Effect.promise(() =>
      expect(acceptHostKey(scoped, [`other-alias ${first}`])).rejects.toThrow(),
    );
    yield* Effect.promise(() =>
      expect(acceptHostKey(scoped, [`@cert-authority msa-env-test ${first}`])).rejects.toThrow(),
    );
    yield* Effect.promise(() =>
      Promise.all([
        acceptHostKey(scoped, [`msa-env-test ${first}`]),
        acceptHostKey(scoped, [`msa-env-test ${first}`]),
      ]),
    );
    expect(yield* readText(knownHosts)).toBe(`msa-env-test ${first}\n`);
    yield* Effect.promise(() =>
      expect(acceptHostKey(scoped, [`msa-env-test ${second}`])).rejects.toBeInstanceOf(
        HostKeyChangedError,
      ),
    );
    yield* Effect.promise(() => forgetHostKey(scoped));
    yield* Effect.promise(() => acceptHostKey(scoped, [`msa-env-test ${second}`]));
    expect(yield* readText(knownHosts)).toBe(`msa-env-test ${second}\n`);
  });

const refusesChangedKey = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    const other = localPath.join(server.root, "other_key");
    yield* keygen(other);
    const knownHosts = localPath.join(server.root, "changed_known_hosts");
    yield* writeText({ path: knownHosts, text: `msa-env-test ${yield* publicKey(other)}\n` });
    yield* Effect.promise(() =>
      expect(
        connectSsh({ ...server.target, binary: daemon, knownHostsFile: knownHosts }),
      ).rejects.toBeInstanceOf(HostKeyChangedError),
    );
  });

describe.skipIf(sshd === undefined)("SSH host keys", () => {
  const server = useSshd(false);
  it(
    "connects lazily and reports a failed start as the error of the operation",
    () => Effect.runPromise(lazyStart(server())),
    60_000,
  );
  it("accepts only host keys for the alias and never replaces a trusted key silently", () =>
    Effect.runPromise(acceptsOnlyAlias(server())));
  it("refuses a changed host key", () => Effect.runPromise(refusesChangedKey(server())), 60_000);
});
