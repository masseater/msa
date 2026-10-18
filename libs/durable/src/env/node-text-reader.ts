import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { StreamDecoder } from "./decode.ts";
import { FileError } from "./file-error.ts";
import type { ReadableFile } from "./node-binary-reader.ts";
import { abortResult, recoverFileError } from "./node-errors.ts";
import { err, ok, type Result } from "./result.ts";
import type { TextLine, TextLineReader } from "./types.ts";

type LineResult = Result<TextLine | undefined, FileError>;

export class NodeTextLineReader implements TextLineReader {
  readonly #file: ReadableFile;
  readonly #path: string;
  readonly #decoder = new StreamDecoder();
  readonly #chunk = new Uint8Array(64 * 1024);
  #byteOffset = 0;
  #buffered = "";
  #ended = false;
  #closed = false;

  constructor(file: ReadableFile, path: string) {
    this.#file = file;
    this.#path = path;
  }

  readLine(context: Context): Promise<LineResult> {
    const aborted = abortResult<TextLine | undefined>(context.abortSignal, this.#path);
    if (aborted !== undefined) return Promise.resolve(aborted);
    if (this.#closed) {
      return Promise.resolve(
        err(new FileError("invalid", "Text line reader is closed", this.#path)),
      );
    }
    return Effect.runPromise(recoverFileError(this.#nextLine(context), this.#path));
  }

  #take(): LineResult | undefined {
    const newline = this.#buffered.indexOf("\n");
    if (newline !== -1) {
      const text = this.#buffered.slice(0, newline);
      this.#buffered = this.#buffered.slice(newline + 1);
      return ok({ text, terminated: true });
    }
    if (!this.#ended) return undefined;
    if (this.#buffered.length === 0) return ok(undefined);
    const text = this.#buffered;
    this.#buffered = "";
    return ok({ text, terminated: false });
  }

  #nextLine(context: Context): Effect.Effect<LineResult> {
    return Effect.gen({ self: this }, function* () {
      for (;;) {
        const line = this.#take();
        if (line !== undefined) return line;
        const { bytesRead } = yield* Effect.promise(() =>
          this.#file.read(this.#chunk, 0, this.#chunk.length, this.#byteOffset),
        );
        const afterReadAbort = abortResult<TextLine | undefined>(context.abortSignal, this.#path);
        if (afterReadAbort !== undefined) return afterReadAbort;
        this.#byteOffset += bytesRead;
        if (bytesRead === 0) {
          this.#buffered += this.#decoder.decode();
          this.#ended = true;
        } else {
          this.#buffered += this.#decoder.decode(this.#chunk.subarray(0, bytesRead));
        }
      }
    });
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#buffered = "";
    return this.#file.close().catch(() => undefined);
  }
}
