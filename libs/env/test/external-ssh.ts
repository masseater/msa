import { DateTime, Effect, Schema } from "effect";

import envModule from "../src/index.ts";
import type sshTypes from "../src/ssh.types.ts";
import daemon from "./daemon.ts";
import environment from "./environment.ts";
import type externalSshTypes from "./external-ssh.types.ts";
import platform from "./platform.ts";

const { acceptHostKey, connectSsh, deployDaemon, detectPlatform, scanHostKey } = envModule;

const { optionalEnv } = environment;
const { localPath, makeTempDirectory, removePath } = platform;

const host = optionalEnv("MSA_ENV_SSH_HOST");
const created: { root?: string } = {};
let connected: Promise<externalSshTypes.Connected> | undefined;

const rootDirectory = Effect.suspend(() =>
  created.root === undefined
    ? Effect.tap(makeTempDirectory("msa-env-ssh-external-"), (directory) =>
        Effect.sync(() => {
          created.root = directory;
        }),
      )
    : Effect.succeed(created.root),
);

function externalTarget(root: string): sshTypes.SshTarget {
  const user = optionalEnv("MSA_ENV_SSH_USER");
  const port = optionalEnv("MSA_ENV_SSH_PORT");
  const identityFile = optionalEnv("MSA_ENV_SSH_KEY");
  const ssh = optionalEnv("MSA_ENV_SSH_PROGRAM");
  return {
    host: host!,
    hostKeyAlias: "msa-env-external",
    knownHostsFile: localPath.join(root, "known_hosts"),
    ...(user === undefined ? {} : { user }),
    ...(port === undefined ? {} : { port: Number(port) }),
    ...(identityFile === undefined ? {} : { identityFile }),
    ...(ssh === undefined ? {} : { ssh }),
  };
}

const toJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const log = (text: string): void => {
  const now = DateTime.formatIso(Effect.runSync(DateTime.now));
  process.stderr.write(`[ssh-external ${now}] ${text}\n`);
};

const establish = Effect.gen(function* () {
  const target = externalTarget(yield* rootDirectory);
  log("scanning the host key");
  const scanned = yield* Effect.promise(() => scanHostKey(target));
  yield* Effect.promise(() => acceptHostKey(target, scanned.lines));
  log("detecting the platform");
  const remote = yield* Effect.promise(() => detectPlatform(target));
  log(`detected ${yield* toJson(remote)}; deploying`);
  log(`deployed ${yield* Effect.promise(() => deployDaemon(target, remote, daemon))}; connecting`);
  const result = yield* Effect.promise(() =>
    connectSsh({
      ...target,
      binary: daemon,
      onLog: (text) => {
        log(`daemon: ${text.trim()}`);
      },
    }),
  );
  log("connected; saying hello");
  const info = yield* Effect.promise(() => result.connection.info());
  log(`hello ${yield* toJson(info)}`);
  return result;
});

function connectExternal(): Promise<externalSshTypes.Connected> {
  connected ??= Effect.runPromise(establish);
  return connected;
}

const closeExternal = (): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (connected !== undefined) (yield* Effect.promise(() => connected!)).connection.close();
      if (created.root !== undefined) yield* removePath(created.root);
    }),
  );

const externalSsh = {
  closeExternal,
  connectExternal,
  host,
};

export default externalSsh;
