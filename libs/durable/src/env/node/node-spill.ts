import { Cause, Effect } from "effect";

import ExecutionError from "../execution-error.ts";
import type executionErrorTypes from "../execution-error.types.ts";
import type fileErrorTypes from "../file-error.types.ts";
import resultModule from "../result.ts";
import nodeHandles from "./node-handles.ts";
import type nodeHandlesTypes from "./node-handles.types.ts";
import type nodeSpillTypes from "./node-spill.types.ts";

const { toError } = resultModule;

const { openAppendStream } = nodeHandles;

const SPILL_HIGH_WATER_MARK = 1024 * 1024;

type SpillChunk = string | Uint8Array;

const countNewlines = (chunk: Uint8Array): number => {
  let count = 0;
  for (let index = chunk.indexOf(0x0a); index !== -1; index = chunk.indexOf(0x0a, index + 1)) {
    count++;
  }
  return count;
};

export default class OutputSpill {
  readonly #hooks: nodeSpillTypes.SpillHooks;
  readonly #prefix: SpillChunk[] = [];
  readonly #queue: SpillChunk[] = [];
  #start: Promise<void> | undefined;
  #stream: nodeHandlesTypes.AppendStream | undefined;
  #backpressured = false;
  #seenBytes = 0;
  #seenNewlines = 0;
  path: string | undefined;
  error: executionErrorTypes.ExecutionError | undefined;

  constructor(hooks: nodeSpillTypes.SpillHooks) {
    this.#hooks = hooks;
  }

  get blocked(): boolean {
    return this.error !== undefined || this.#backpressured;
  }

  get draining(): boolean {
    return (
      this.error === undefined &&
      this.#start !== undefined &&
      (this.#stream === undefined || this.#backpressured)
    );
  }

  readonly fail = (error: unknown): void => {
    if (this.error !== undefined) return;
    const cause = toError(error);
    this.error = ExecutionError.create(
      "unknown",
      `Failed to preserve complete shell output: ${cause.message}`,
      cause,
    );
    this.#backpressured = false;
    this.#hooks.abort();
  };

  feed(chunk: Uint8Array, threshold: nodeSpillTypes.SpillThreshold | undefined): void {
    if (threshold === undefined || chunk.length === 0) return;
    if (this.#start !== undefined) {
      this.#begin(chunk);
      return;
    }
    this.#seenBytes += chunk.length;
    this.#seenNewlines += countNewlines(chunk);
    const lines = this.#seenNewlines + (chunk[chunk.length - 1] === 0x0a ? 0 : 1);
    if (this.#seenBytes <= threshold.afterBytes && lines <= threshold.afterLines) {
      this.#prefix.push(chunk);
      return;
    }
    for (const prefix of this.#prefix) this.#begin(prefix);
    this.#prefix.length = 0;
    this.#begin(chunk);
  }

  #write(chunk: SpillChunk): void {
    const stream = this.#stream;
    if (stream === undefined || chunk.length === 0) return;
    if (stream.write(chunk) || this.#backpressured) return;
    this.#backpressured = true;
    this.#hooks.pause();
    stream.once("drain", () => {
      this.#backpressured = false;
      this.#hooks.resume();
    });
  }

  #begin(chunk: SpillChunk): void {
    if (this.#stream !== undefined) {
      this.#write(chunk);
      return;
    }
    this.#queue.push(chunk);
    if (this.#start !== undefined) return;
    this.#hooks.pause();
    this.#start = Effect.runPromise(
      this.#open().pipe(
        Effect.catchCause((cause) => Effect.sync(() => this.fail(Cause.squash(cause)))),
        Effect.ensuring(Effect.sync(this.#hooks.resume)),
      ),
    );
  }

  #open(): Effect.Effect<void, fileErrorTypes.FileError> {
    return Effect.gen({ self: this }, function* () {
      const created = yield* this.#hooks.createTempFile;
      if (!created.ok) return yield* created.error;
      this.path = created.value;
      this.#stream = openAppendStream({
        highWaterMark: SPILL_HIGH_WATER_MARK,
        path: this.path,
      });
      this.#stream.on("error", this.fail);
      for (const queued of this.#queue) this.#write(queued);
      this.#queue.length = 0;
    });
  }

  finish(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const start = this.#start;
      if (start !== undefined) yield* Effect.promise(() => start);
      const stream = this.#stream;
      if (stream === undefined || this.error !== undefined || stream.destroyed) return;
      yield* Effect.callback<void>((resume) => {
        stream.once("error", () => resume(Effect.void));
        stream.once("finish", () => resume(Effect.void));
        stream.end();
      });
    });
  }
}
