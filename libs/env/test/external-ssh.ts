import { DateTime, Effect, Schema } from "effect";

import type { Connection } from "../src/connection.ts";
import {
  acceptHostKey,
  connectSsh,
  deployDaemon,
  detectPlatform,
  type RemotePlatform,
  type SshTarget,
  scanHostKey,
} from "../src/ssh.ts";
import { daemon } from "./daemon.ts";
import { optionalEnv } from "./environment.ts";
import { localPath, makeTempDirectory, removePath } from "./platform.ts";

export type Connected = { connection: Connection; remote: RemotePlatform };

export const host = optionalEnv("MSA_ENV_SSH_HOST");
const root = await Effect.runPromise(makeTempDirectory("msa-env-ssh-external-"));
let connected: Promise<Connected> | undefined;

function externalTarget(): SshTarget {
  const user = optionalEnv("MSA_ENV_SSH_USER");
  const port = optionalEnv("MSA_ENV_SSH_PORT");
  const identityFile = optionalEnv("MSA_ENV_SSH_KEY");
  const ssh = optionalEnv("MSA_ENV_SSH_PROGRAM");
  return {
    host: host!,
    ...(user === undefined ? {} : { user }),
    ...(port === undefined ? {} : { port: Number(port) }),
    ...(identityFile === undefined ? {} : { identityFile }),
    ...(ssh === undefined ? {} : { ssh }),
    knownHostsFile: localPath.join(root, "known_hosts"),
    hostKeyAlias: "msa-env-external",
  };
}

const toJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const log = (text: string): void => {
  const now = DateTime.formatIso(Effect.runSync(DateTime.now));
  process.stderr.write(`[ssh-external ${now}] ${text}\n`);
};

const establish = Effect.gen(function* () {
  const target = externalTarget();
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

export function connectExternal(): Promise<Connected> {
  connected ??= Effect.runPromise(establish);
  return connected;
}

export const closeExternal = (): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (connected !== undefined) (yield* Effect.promise(() => connected!)).connection.close();
      yield* removePath(root);
    }),
  );
