import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { Json } from "./remote-error.ts";

export interface Reply {
  json: Json;
  payload: Uint8Array;
  session: number;
}

export type Pending = {
  resolve: (value: Reply) => void;
  reject: (error: Error) => void;
  onEvent?: (json: Json, payload: Uint8Array) => void;
};

export class Session {
  readonly id: number;
  readonly child: ChildProcessWithoutNullStreams;
  readonly token: string;
  readonly pending = new Map<number, Pending>();
  chunks: Buffer[] = [];
  buffered = 0;
  synced = false;
  lastSeen: number;
  timer: ReturnType<typeof setInterval> | undefined;
  live = true;

  constructor(id: number, child: ChildProcessWithoutNullStreams, token: string, now: number) {
    this.id = id;
    this.child = child;
    this.token = token;
    this.lastSeen = now;
  }

  peek(length: number): Buffer {
    if (this.chunks[0]!.length < length) {
      this.chunks = [Buffer.concat(this.chunks)];
    }
    return this.chunks[0]!.subarray(0, length);
  }

  consume(length: number): void {
    this.buffered -= length;
    let remaining = length;
    while (remaining > 0) {
      const first = this.chunks[0]!;
      if (first.length <= remaining) {
        this.chunks.shift();
        remaining -= first.length;
      } else {
        this.chunks[0] = first.subarray(remaining);
        remaining = 0;
      }
    }
  }
}
