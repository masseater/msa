import type connectionTypes from "./connection.types.ts";
import type detectTypes from "./detect.types.ts";
import type envErrorsTypes from "./env-errors.types.ts";
import type envSshTypes from "./env-ssh.types.ts";
import type listFilesTypes from "./list-files.types.ts";
import type remoteEnvTypes from "./remote-env.types.ts";
import type remoteInfoTypes from "./remote-info.types.ts";
import type sessionTypes from "./session.types.ts";
import type terminalTypes from "./terminal.types.ts";
import type watchTypes from "./watch.types.ts";

declare namespace envTypes {
  type Reply = sessionTypes.Reply;

  type LocalExecutionEnvOptions = listFilesTypes.LocalExecutionEnvOptions;

  type ConnectionOptions = remoteInfoTypes.ConnectionOptions;

  type RemoteInfo = remoteInfoTypes.RemoteInfo;

  type RequestOptions = remoteInfoTypes.RequestOptions;

  type RemoteExecutionEnvOptions = remoteEnvTypes.RemoteExecutionEnvOptions;

  type RemotePlatform = detectTypes.RemotePlatform;

  type SshConnectOptions = envSshTypes.SshConnectOptions;

  type SshTarget = envSshTypes.SshTarget;

  type TerminalForeground = terminalTypes.TerminalForeground;

  type TerminalOptions = terminalTypes.TerminalOptions;

  type RemoteWatchOptions = watchTypes.RemoteWatchOptions;

  type Connection = connectionTypes.Connection;

  type RemoteError = envErrorsTypes.RemoteError;

  type LocalExecutionEnv = listFilesTypes.LocalExecutionEnv;

  type RemoteExecutionEnv = remoteEnvTypes.RemoteExecutionEnv;

  type HostKeyChangedError = envErrorsTypes.HostKeyChangedError;

  type HostKeyUnknownError = envErrorsTypes.HostKeyUnknownError;

  type SshError = envErrorsTypes.SshError;

  type RemoteTerminal = terminalTypes.RemoteTerminal;

  type RemoteWatcher = watchTypes.RemoteWatcher;
}

export type { envTypes as default };
