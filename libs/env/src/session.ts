import { type Cause, Effect, Exit, Queue, Scope } from "effect";

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

export interface SessionStart {
  readonly id: number;
  readonly input: Queue.Queue<Uint8Array, Cause.Done>;
  readonly scope: Scope.Closeable;
  readonly token: string;
  readonly now: number;
}

export class Session {
  readonly id: number;
  readonly input: Queue.Queue<Uint8Array, Cause.Done>;
  readonly scope: Scope.Closeable;
  readonly token: string;
  readonly pending = new Map<number, Pending>();
  chunks: Buffer[] = [];
  buffered = 0;
  synced = false;
  lastSeen: number;
  live = true;

  constructor(start: SessionStart) {
    this.id = start.id;
    this.input = start.input;
    this.scope = start.scope;
    this.token = start.token;
    this.lastSeen = start.now;
  }

  write(data: Uint8Array): void {
    Queue.offerUnsafe(this.input, data);
  }

  end(): void {
    Queue.endUnsafe(this.input);
    Effect.runFork(Scope.close(this.scope, Exit.void));
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
