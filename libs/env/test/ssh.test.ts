import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import envModule2 from "@msa/durable/env";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import envModule from "../src/index.ts";
import RemoteExecutionEnv from "../src/remote-env.ts";
import daemon from "./daemon.ts";
import platform from "./platform.ts";
import sshdModule from "./sshd.ts";
import type sshdTypes from "./sshd.types.ts";

const { getOrThrow } = envModule2;

const { HostKeyUnknownError, acceptHostKey, connectSsh, scanHostKey } = envModule;

const { localPath, makeDirectory, modifiedAt, readBytes, readNames, writeText } = platform;
const { deployedName, sshd, useSshd } = sshdModule;

const context = BACKGROUND_CONTEXT;

const tools = (server: sshdTypes.SshServer): string =>
  localPath.join(server.home, ".msa/mobile/tools");

const sameAsDaemon = (file: string): Effect.Effect<boolean> =>
  Effect.map(Effect.all([readBytes(file), readBytes(daemon)]), ([deployed, built]) =>
    Buffer.from(deployed).equals(built),
  );

const connect = (server: sshdTypes.SshServer): ReturnType<typeof connectSsh> =>
  connectSsh({ ...server.target, binary: daemon });

const runOverSsh = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.promise(() => connect(server)),
    ({ connection, remote }) =>
      Effect.gen(function* () {
        expect(remote.home).toBe(server.home);
        expect(yield* sameAsDaemon(localPath.join(tools(server), deployedName))).toBe(true);
        const names = yield* readNames(tools(server));
        expect(names.filter((name) => name.startsWith("msa-env-"))).toEqual([deployedName]);
        const env = new RemoteExecutionEnv({ connection, cwd: server.home, id: "msa-env:test" });
        getOrThrow(yield* Effect.promise(() => env.writeFile("over-ssh.txt", "hello", context)));
        const read = yield* Effect.promise(() => env.readTextFile("over-ssh.txt", context));
        expect(getOrThrow(read)).toBe("hello");
        const output: string[] = [];
        const onOutput = (text: string): void => {
          output.push(text);
        };
        const result = yield* Effect.promise(() =>
          env.exec(["sh", "-c", 'printf "%s" "$HOME"'], { onOutput }, context),
        );
        expect(getOrThrow(result).exitCode).toBe(0);
        expect(output.join("")).toBe(server.home);
      }),
    ({ connection }) =>
      Effect.sync(() => {
        connection.close();
      }),
  );

const deploysOnceTrusted = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      expect(connect(server)).rejects.toBeInstanceOf(HostKeyUnknownError),
    );
    const scanned = yield* Effect.promise(() => scanHostKey(server.target));
    expect(scanned.fingerprints.join("\n")).toContain(server.hostFingerprint);
    yield* Effect.promise(() => acceptHostKey(server.target, scanned.lines));
    yield* makeDirectory(tools(server));
    yield* writeText({
      path: localPath.join(tools(server), "msa-env-0123456789abcdef0123456789abcdef"),
      text: "old",
    });
    yield* runOverSsh(server);
  });

const reusesVerified = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    const file = localPath.join(tools(server), deployedName);
    const before = yield* modifiedAt(file);
    (yield* Effect.promise(() => connect(server))).connection.close();
    expect(yield* modifiedAt(file)).toBe(before);
    yield* writeText({ path: file, text: "tampered" });
    yield* Effect.acquireUseRelease(
      Effect.promise(() => connect(server)),
      ({ connection }) =>
        Effect.gen(function* () {
          expect(yield* sameAsDaemon(file)).toBe(true);
          expect((yield* Effect.promise(() => connection.info())).home).toBe(server.home);
        }),
      ({ connection }) =>
        Effect.sync(() => {
          connection.close();
        }),
    );
  });

const verifiesAfterLoss = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.promise(() => connect(server)),
    ({ connection }) =>
      Effect.gen(function* () {
        const file = localPath.join(tools(server), deployedName);
        const { pid } = yield* Effect.promise(() => connection.info());
        process.kill(pid, "SIGKILL");
        yield* Effect.sleep(300);
        yield* writeText({ path: file, text: "tampered" });
        expect((yield* Effect.promise(() => connection.info())).pid).not.toBe(pid);
        expect(yield* sameAsDaemon(file)).toBe(true);
      }),
    ({ connection }) =>
      Effect.sync(() => {
        connection.close();
      }),
  );

describe.skipIf(sshd === undefined)("SSH bootstrap", () => {
  const server = useSshd(false);
  it(
    "refuses an untrusted host, then deploys and runs the daemon once its key is accepted",
    () => Effect.runPromise(deploysOnceTrusted(server())),
    60_000,
  );
  it(
    "reuses a verified daemon and replaces a tampered one",
    () => Effect.runPromise(reusesVerified(server())),
    60_000,
  );
  it(
    "verifies the daemon again before starting it after a lost connection",
    () => Effect.runPromise(verifiesAfterLoss(server())),
    60_000,
  );
});
