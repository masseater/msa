import type chordTypes from "@msa/chord/index.types";
import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";

import errors from "./errors.ts";
import type handleTypes from "./handle.types.ts";

const { FileError, StreamDecoder, err, ok } = env;

const { abortResult, recoverFileError } = errors;

const LINE_CHUNK = 64 * 1024;

type LineResult = envTypes.Result<envTypes.TextLine | undefined, envTypes.FileError>;

export default class RemoteTextLineReader implements envTypes.TextLineReader {
  readonly #handle: handleTypes.Handle;
  readonly #decoder = new StreamDecoder();
  #offset = 0;
  #buffered = "";
  #ended = false;
  #closed = false;

  constructor(handle: handleTypes.Handle) {
    this.#handle = handle;
  }

  readLine(context: chordTypes.Context): Promise<LineResult> {
    const path = this.#handle.path;
    const aborted = abortResult<envTypes.TextLine | undefined>(context.abortSignal, path);
    if (aborted !== undefined) return Promise.resolve(aborted);
    if (this.#closed) {
      return Promise.resolve(err(FileError.create("invalid", "Text line reader is closed", path)));
    }
    return Effect.runPromise(recoverFileError(this.#next(context), path));
  }

  #take(): LineResult | undefined {
    const newline = this.#buffered.indexOf("\n");
    if (newline !== -1) {
      const text = this.#buffered.slice(0, newline);
      this.#buffered = this.#buffered.slice(newline + 1);
      return ok({ terminated: true, text });
    }
    if (!this.#ended) return undefined;
    if (this.#buffered.length === 0) return ok(undefined);
    const text = this.#buffered;
    this.#buffered = "";
    return ok({ terminated: false, text });
  }

  #next(context: chordTypes.Context): Effect.Effect<LineResult> {
    return Effect.gen({ self: this }, function* () {
      for (;;) {
        const line = this.#take();
        if (line !== undefined) return line;
        const bytes = yield* Effect.promise(() => this.#handle.pread(this.#offset, LINE_CHUNK));
        const afterReadAbort = abortResult<envTypes.TextLine | undefined>(
          context.abortSignal,
          this.#handle.path,
        );
        if (afterReadAbort !== undefined) return afterReadAbort;
        this.#offset += bytes.length;
        if (bytes.length === 0) {
          this.#buffered += this.#decoder.decode();
          this.#ended = true;
        } else {
          this.#buffered += this.#decoder.decode(bytes);
        }
      }
    });
  }

  close(_context: chordTypes.Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#buffered = "";
    return this.#handle.close();
  }
}
