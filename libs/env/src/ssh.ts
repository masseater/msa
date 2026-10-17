import { Effect } from "effect";

import { Connection } from "./connection.ts";
import { deployDaemonEffect, packagedDaemon, quotePosix, quotePowerShell } from "./deploy.ts";
import { type DetectFailure, detectPlatformEffect, type RemotePlatform } from "./detect.ts";
import type { ConnectionOptions } from "./remote-info.ts";
import { sshArguments, type SshTarget } from "./ssh-args.ts";

export { scanHostKey } from "./host-key-scan.ts";
export { acceptHostKey, forgetHostKey } from "./known-hosts.ts";
export { HostKeyChangedError } from "./host-key-changed-error.ts";
export { HostKeyUnknownError } from "./host-key-unknown-error.ts";
export { deployDaemon, localDaemon, packagedDaemon } from "./deploy.ts";
export { detectPlatform, type RemotePlatform } from "./detect.ts";
export { sshArguments, type SshTarget } from "./ssh-args.ts";
export { SshError } from "./ssh-error.ts";

export interface SshConnectOptions extends SshTarget {
  binary?: string;
  loginShell?: boolean;
  onLog?: ConnectionOptions["onLog"];
}

function launchCommand(remote: RemotePlatform, file: string, loginShell: boolean): string {
  if (remote.platform === "windows") {
    if (remote.shell === "powershell") return `& ${quotePowerShell(file)}`;
    return file.includes(" ") ? `"${file}"` : file;
  }
  if (loginShell) return `exec "$SHELL" -lc 'exec "$0" "$@"' ${quotePosix(file)}`;
  return quotePosix(file);
}

type SshState = { remote?: RemotePlatform; verified?: string | undefined };

const logWarnings = (options: SshConnectOptions, remote: RemotePlatform): void => {
  for (const warning of remote.warnings) options.onLog?.(`${warning}\n`);
};

const startCommand = (
  options: SshConnectOptions,
  state: SshState,
): Effect.Effect<readonly string[], DetectFailure> =>
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
        target: options,
        remote,
        binary: options.binary ?? packagedDaemon(remote),
      }));
    state.verified = undefined;
    return [
      options.ssh ?? "ssh",
      ...sshArguments(options),
      launchCommand(remote, file, options.loginShell === true),
    ];
  });

function sshConnectionFor(options: SshConnectOptions, state: SshState): Connection {
  return new Connection({
    command: () => Effect.runPromise(startCommand(options, state)),
    ...(options.onLog === undefined ? {} : { onLog: options.onLog }),
  });
}

export function sshConnection(options: SshConnectOptions): {
  connection: Connection;
  remote(): RemotePlatform | undefined;
} {
  const state: SshState = {};
  return { connection: sshConnectionFor(options, state), remote: () => state.remote };
}

export function connectSsh(
  options: SshConnectOptions,
): Promise<{ connection: Connection; remote: RemotePlatform }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const remote = yield* detectPlatformEffect(options);
      const verified = yield* deployDaemonEffect({
        target: options,
        remote,
        binary: options.binary ?? packagedDaemon(remote),
      });
      logWarnings(options, remote);
      return { connection: sshConnectionFor(options, { remote, verified }), remote };
    }),
  );
}
