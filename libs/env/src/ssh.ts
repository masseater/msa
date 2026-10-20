import { Effect } from "effect";

import connectionModule from "./connection.ts";
import type connectionTypes from "./connection.types.ts";
import deploy from "./deploy.ts";
import detect from "./detect.ts";
import type detectTypes from "./detect.types.ts";
import sshArgs from "./ssh-args.ts";
import type sshTypes from "./ssh.types.ts";

const { deployDaemonEffect, packagedDaemon, quotePosix, quotePowerShell } = deploy;
const { detectPlatformEffect } = detect;
const { sshArguments } = sshArgs;
const { Connection } = connectionModule;

function launchCommand(
  remote: detectTypes.RemotePlatform,
  file: string,
  loginShell: boolean,
): string {
  if (remote.platform === "windows") {
    if (remote.shell === "powershell") return `& ${quotePowerShell(file)}`;
    return file.includes(" ") ? `"${file}"` : file;
  }
  if (loginShell) return `exec "$SHELL" -lc 'exec "$0" "$@"' ${quotePosix(file)}`;
  return quotePosix(file);
}

type SshState = { remote?: detectTypes.RemotePlatform; verified?: string | undefined };

const logWarnings = (
  options: sshTypes.SshConnectOptions,
  remote: detectTypes.RemotePlatform,
): void => {
  for (const warning of remote.warnings) options.onLog?.(`${warning}\n`);
};

const startCommand = (
  options: sshTypes.SshConnectOptions,
  state: SshState,
): Effect.Effect<readonly string[], detectTypes.DetectFailure> =>
  Effect.gen(function* () {
    if (state.remote === undefined) {
      const detected = yield* detectPlatformEffect(options);
      logWarnings(options, detected);
      state.remote = detected;
    }
    const remote = state.remote;
    const file =
      state.verified ??
      (yield* deployDaemonEffect({
        binary: options.binary ?? packagedDaemon(remote),
        remote,
        target: options,
      }));
    state.verified = undefined;
    return [
      options.ssh ?? "ssh",
      ...sshArguments(options),
      launchCommand(remote, file, options.loginShell === true),
    ];
  });

function sshConnectionFor(
  options: sshTypes.SshConnectOptions,
  state: SshState,
): connectionTypes.Connection {
  return new Connection({
    command: () => Effect.runPromise(startCommand(options, state)),
    ...(options.onLog === undefined ? {} : { onLog: options.onLog }),
  });
}

function sshConnection(options: sshTypes.SshConnectOptions): {
  connection: connectionTypes.Connection;
  remote(): detectTypes.RemotePlatform | undefined;
} {
  const state: SshState = {};
  return { connection: sshConnectionFor(options, state), remote: () => state.remote };
}

function connectSsh(
  options: sshTypes.SshConnectOptions,
): Promise<{ connection: connectionTypes.Connection; remote: detectTypes.RemotePlatform }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const remote = yield* detectPlatformEffect(options);
      const verified = yield* deployDaemonEffect({
        binary: options.binary ?? packagedDaemon(remote),
        remote,
        target: options,
      });
      logWarnings(options, remote);
      return { connection: sshConnectionFor(options, { remote, verified }), remote };
    }),
  );
}

const sshModule = {
  connectSsh,
  sshConnection,
};

export default sshModule;
