import connection from "./connection.ts";
import envDaemon from "./env-daemon.ts";
import envErrors from "./env-errors.ts";
import envSsh from "./env-ssh.ts";
import LocalExecutionEnv from "./local-execution-env.ts";
import RemoteExecutionEnv from "./remote-env.ts";
import terminal from "./terminal.ts";
import RemoteWatcher from "./watch.ts";

const env = {
  ...envDaemon,
  ...envErrors,
  ...envSsh,
  Connection: connection.Connection,
  LocalExecutionEnv: LocalExecutionEnv,
  RemoteExecutionEnv: RemoteExecutionEnv,
  RemoteTerminal: terminal.RemoteTerminal,
  RemoteWatcher: RemoteWatcher,
  openTerminal: terminal.openTerminal,
};

export default env;
