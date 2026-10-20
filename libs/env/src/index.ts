import connection from "./connection.ts";
import envDaemon from "./env-daemon.ts";
import envErrors from "./env-errors.ts";
import envSsh from "./env-ssh.ts";
import listFilesModule from "./list-files.ts";
import remoteEnv from "./remote-env.ts";
import terminal from "./terminal.ts";
import watch from "./watch.ts";

const env = {
  ...envDaemon,
  ...envErrors,
  ...envSsh,
  Connection: connection.Connection,
  LocalExecutionEnv: listFilesModule.LocalExecutionEnv,
  RemoteExecutionEnv: remoteEnv.RemoteExecutionEnv,
  RemoteTerminal: terminal.RemoteTerminal,
  RemoteWatcher: watch.RemoteWatcher,
  openTerminal: terminal.openTerminal,
};

export default env;
