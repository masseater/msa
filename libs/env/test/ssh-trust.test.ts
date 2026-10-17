import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { RemoteExecutionEnv } from "../src/remote-env.ts";
import {
  acceptHostKey,
  connectSsh,
  forgetHostKey,
  HostKeyChangedError,
  scanHostKey,
  sshConnection,
} from "../src/ssh.ts";
import { daemon } from "./daemon.ts";
import { keygen, publicKey, type SshServer, sshd, useSshd } from "./sshd.ts";

const context = BACKGROUND_CONTEXT;

const lazyStart = (server: SshServer): Effect.Effect<void> => {
  const lazyTarget = { ...server.target, knownHostsFile: join(server.root, "lazy_known_hosts") };
  const { connection, remote } = sshConnection({ ...lazyTarget, binary: daemon });
  return Effect.gen(function* () {
    expect(remote()).toBeUndefined();
    const env = new RemoteExecutionEnv({ connection, id: "msa-env:test", cwd: server.home });
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

const acceptsOnlyAlias = (server: SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    const knownHosts = join(server.root, "accept_known_hosts");
    const scoped = { ...server.target, knownHostsFile: knownHosts };
    const key = (name: string): string => {
      const file = join(server.root, name);
      keygen(file);
      return publicKey(file);
    };
    const first = key("accept_first");
    const second = key("accept_second");
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
    expect(readFileSync(knownHosts, "utf8")).toBe(`msa-env-test ${first}\n`);
    yield* Effect.promise(() =>
      expect(acceptHostKey(scoped, [`msa-env-test ${second}`])).rejects.toBeInstanceOf(
        HostKeyChangedError,
      ),
    );
    yield* Effect.promise(() => forgetHostKey(scoped));
    yield* Effect.promise(() => acceptHostKey(scoped, [`msa-env-test ${second}`]));
    expect(readFileSync(knownHosts, "utf8")).toBe(`msa-env-test ${second}\n`);
  });

const refusesChangedKey = (server: SshServer): Promise<void> => {
  const other = join(server.root, "other_key");
  keygen(other);
  const knownHosts = join(server.root, "changed_known_hosts");
  writeFileSync(knownHosts, `msa-env-test ${publicKey(other)}\n`);
  return expect(
    connectSsh({ ...server.target, knownHostsFile: knownHosts, binary: daemon }),
  ).rejects.toBeInstanceOf(HostKeyChangedError);
};

describe.skipIf(sshd === undefined)("SSH host keys", () => {
  const server = useSshd(false);
  it(
    "connects lazily and reports a failed start as the error of the operation",
    () => Effect.runPromise(lazyStart(server())),
    60_000,
  );
  it("accepts only host keys for the alias and never replaces a trusted key silently", () =>
    Effect.runPromise(acceptsOnlyAlias(server())));
  it("refuses a changed host key", () => refusesChangedKey(server()), 60_000);
});
