import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import FileError from "../file-error.ts";
import type fileErrorTypes from "../file-error.types.ts";
import resultModule from "../result.ts";
import type resultTypes from "../result.types.ts";
import StreamDecoder from "../stream-decoder.ts";
import type typesModule from "../types.ts";
import type nodeBinaryReaderTypes from "./node-binary-reader.types.ts";
import nodeErrors from "./node-errors.ts";

const { abortResult, recoverFileError } = nodeErrors;
const { err, ok } = resultModule;

type LineResult = resultTypes.Result<typesModule.TextLine | undefined, fileErrorTypes.FileError>;

export default class NodeTextLineReader implements typesModule.TextLineReader {
  readonly #file: nodeBinaryReaderTypes.ReadableFile;
  readonly #path: string;
  readonly #decoder = new StreamDecoder();
  readonly #chunk = new Uint8Array(64 * 1024);
  #byteOffset = 0;
  #buffered = "";
  #ended = false;
  #closed = false;

  constructor(file: nodeBinaryReaderTypes.ReadableFile, path: string) {
    this.#file = file;
    this.#path = path;
  }

  readLine(context: chordTypes.Context): Promise<LineResult> {
    const aborted = abortResult<typesModule.TextLine | undefined>(context.abortSignal, this.#path);
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
      return ok({ terminated: true, text });
    }
    if (!this.#ended) return undefined;
    if (this.#buffered.length === 0) return ok(undefined);
    const text = this.#buffered;
    this.#buffered = "";
    return ok({ terminated: false, text });
  }

  #nextLine(context: chordTypes.Context): Effect.Effect<LineResult> {
    return Effect.gen({ self: this }, function* () {
      for (;;) {
        const line = this.#take();
        if (line !== undefined) return line;
        const { bytesRead } = yield* Effect.promise(() =>
          this.#file.read(this.#chunk, 0, this.#chunk.length, this.#byteOffset),
        );
        const afterReadAbort = abortResult<typesModule.TextLine | undefined>(
          context.abortSignal,
          this.#path,
        );
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

  close(_context: chordTypes.Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#buffered = "";
    return this.#file.close().catch(() => undefined);
  }
}
