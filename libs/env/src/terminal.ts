import { dual } from "effect/Function";

import type connectionTypes from "./connection.types.ts";
import RemoteTerminal from "./remote-terminal.ts";
import type terminalTypes from "./terminal.types.ts";

function startTerminal(
  connection: connectionTypes.Connection,
  options: terminalTypes.TerminalOptions,
): Promise<RemoteTerminal> {
  const abort = new AbortController();
  const started = Promise.withResolvers<RemoteTerminal>();
  let request: { id: number; session: number } | undefined;
  const exited = connection
    .request(
      "pty",
      {
        cwd: options.cwd,
        ...(options.argv === undefined ? {} : { argv: options.argv }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.inheritEnv === undefined ? {} : { inheritEnv: options.inheritEnv }),
        cols: options.cols,
        rows: options.rows,
      },
      {
        onEvent: (json, payload) => {
          if (json["kind"] === "output") options.onData(payload);
          else if (json["kind"] === "started" && request !== undefined) {
            started.resolve(
              new RemoteTerminal(
                connection,
                request.id,
                request.session,
                Number(json["pid"]),
                exited,
                abort,
              ),
            );
          }
        },
        onStart: (id, session) => {
          request = { id, session };
        },
        signal: abort.signal,
      },
    )
    .then((reply) => Number(reply.json["exitCode"]));
  exited.catch(started.reject);
  return started.promise;
}

const openTerminal: {
  (
    options: terminalTypes.TerminalOptions,
  ): (connection: connectionTypes.Connection) => Promise<RemoteTerminal>;
  (
    connection: connectionTypes.Connection,
    options: terminalTypes.TerminalOptions,
  ): Promise<RemoteTerminal>;
} = dual(2, startTerminal);

const terminal = {
  RemoteTerminal,
  openTerminal,
};

export default terminal;
