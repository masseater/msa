import { dual } from "effect/Function";

import type connectionTypes from "./connection.types.ts";
import type terminalTypes from "./terminal.types.ts";

const WRITE_CHUNK = 1024 * 1024;

class RemoteTerminal {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly #connection: connectionTypes.Connection;
  readonly #id: number;
  readonly #session: number;
  readonly #abort: AbortController;

  constructor(
    connection: connectionTypes.Connection,
    id: number,
    session: number,
    pid: number,
    exited: Promise<number>,
    abort: AbortController,
  ) {
    this.#connection = connection;
    this.#id = id;
    this.#session = session;
    this.pid = pid;
    this.exited = exited;
    this.#abort = abort;
  }

  write(data: Uint8Array | string): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK) {
      this.#request("ptyWrite", {}, bytes.subarray(offset, offset + WRITE_CHUNK));
    }
  }

  resize(cols: number, rows: number): void {
    this.#request("ptyResize", { cols, rows });
  }

  close(): void {
    this.#abort.abort();
  }

  foreground(): Promise<terminalTypes.TerminalForeground | undefined> {
    return this.#connection
      .request("ptyForeground", { target: this.#id }, { session: this.#session })
      .then((reply) => {
        const foreground = reply.json["foreground"] as {
          pid: number;
          name: string | null;
        } | null;
        if (foreground === null || foreground === undefined) return undefined;
        return {
          pid: foreground.pid,
          ...(foreground.name === null || foreground.name === "" ? {} : { name: foreground.name }),
        };
      });
  }

  #request(op: string, json: connectionTypes.Json, payload?: Uint8Array): void {
    this.#connection
      .request(
        op,
        { ...json, target: this.#id },
        { session: this.#session, ...(payload === undefined ? {} : { payload }) },
      )
      .catch(() => {});
  }
}

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
