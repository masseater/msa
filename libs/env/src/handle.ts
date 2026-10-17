import type { Connection, Json, Reply } from "./connection.ts";

export class Handle {
  readonly connection: Connection;
  readonly id: number;
  readonly session: number;
  readonly path: string;

  constructor(connection: Connection, reply: Reply, path: string) {
    this.connection = connection;
    this.id = reply.json["handle"] as number;
    this.session = reply.session;
    this.path = path;
  }

  request(
    op: string,
    json: Json = {},
    options: { signal?: AbortSignal; payload?: Uint8Array } = {},
  ): Promise<Reply> {
    return this.connection.request(
      op,
      { ...json, handle: this.id },
      { ...options, session: this.session },
    );
  }

  pread(offset: number | undefined, length: number): Promise<Uint8Array> {
    return this.request("pread", { ...(offset === undefined ? {} : { offset }), length }).then(
      (reply) => reply.payload,
    );
  }

  close(): Promise<void> {
    return this.request("close").then(
      () => undefined,
      () => undefined,
    );
  }
}
