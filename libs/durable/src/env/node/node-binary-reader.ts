import type { Context } from "@msa/chord";
import { Effect, Exit } from "effect";

import FileError from "../file-error.ts";
import LineScanner from "../line-scan.ts";
import resultModule from "../result.ts";
import type resultTypes from "../result.types.ts";
import type typesModule from "../types.ts";
import type nodeBinaryReaderTypes from "./node-binary-reader.types.ts";
import nodeErrors from "./node-errors.ts";
import nodePaths from "./node-paths.ts";

const { abortResult, closedResult, recoverFileError } = nodeErrors;
const { fileInfoFromStats } = nodePaths;
const { err, ok } = resultModule;

const BINARY_READ_CHUNK = 1024 * 1024;
const SCAN_CHUNK = 64 * 1024;

const concatChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const [only] = chunks;
  if (chunks.length === 1 && only !== undefined) return only;
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return bytes;
};

const invalidRange = (offset: number, length: number): boolean =>
  !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0;

export default class NodeBinaryReader implements typesModule.BinaryReader {
  readonly #file: nodeBinaryReaderTypes.ReadableFile;
  readonly #path: string;
  #closed = false;

  constructor(file: nodeBinaryReaderTypes.ReadableFile, path: string) {
    this.#file = file;
    this.#path = path;
  }

  #unavailable<T>(
    context: Context,
  ): resultTypes.Result<T, nodeBinaryReaderTypes.FileError> | undefined {
    const aborted = abortResult<T>(context.abortSignal, this.#path);
    if (aborted !== undefined) return aborted;
    return this.#closed ? closedResult<T>("Binary reader", this.#path) : undefined;
  }

  #run<T>(
    effect: Effect.Effect<resultTypes.Result<T, nodeBinaryReaderTypes.FileError>>,
  ): Promise<resultTypes.Result<T, nodeBinaryReaderTypes.FileError>> {
    return Effect.runPromise(recoverFileError(effect, this.#path));
  }

  #readAt(chunk: Uint8Array, position: number): Effect.Effect<number> {
    return Effect.map(
      Effect.promise(() => this.#file.read(chunk, 0, chunk.length, position)),
      ({ bytesRead }) => bytesRead,
    );
  }

  info(
    context: Context,
  ): Promise<resultTypes.Result<typesModule.FileInfo, nodeBinaryReaderTypes.FileError>> {
    const unavailable = this.#unavailable<typesModule.FileInfo>(context);
    if (unavailable !== undefined) return Promise.resolve(unavailable);
    return this.#run(
      Effect.map(
        Effect.promise(() => this.#file.stat()),
        (stats) => fileInfoFromStats(this.#path, stats),
      ),
    );
  }

  read(
    offset: number,
    length: number,
    context: Context,
  ): Promise<resultTypes.Result<Uint8Array, nodeBinaryReaderTypes.FileError>> {
    const unavailable = this.#unavailable<Uint8Array>(context);
    if (unavailable !== undefined) return Promise.resolve(unavailable);
    if (invalidRange(offset, length)) {
      return Promise.resolve(
        err(
          new FileError(
            "invalid",
            "Offset and length must be non-negative safe integers",
            this.#path,
          ),
        ),
      );
    }
    return this.#run(this.#readRange(offset, length, context));
  }

  #readRange(
    offset: number,
    length: number,
    context: Context,
  ): Effect.Effect<resultTypes.Result<Uint8Array, nodeBinaryReaderTypes.FileError>> {
    return Effect.gen({ self: this }, function* () {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < length) {
        const chunk = new Uint8Array(Math.min(length - total, BINARY_READ_CHUNK));
        const bytesRead = yield* this.#readAt(chunk, offset + total);
        const afterReadAbort = abortResult<Uint8Array>(context.abortSignal, this.#path);
        if (afterReadAbort !== undefined) return afterReadAbort;
        if (bytesRead === 0) break;
        chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
        total += bytesRead;
      }
      return ok(concatChunks(chunks, total));
    });
  }

  scanLines(
    options: { startLine: number; endLine?: number },
    context: Context,
  ): Promise<resultTypes.Result<typesModule.LineScan, nodeBinaryReaderTypes.FileError>> {
    const unavailable = this.#unavailable<typesModule.LineScan>(context);
    if (unavailable !== undefined) return Promise.resolve(unavailable);
    const scanner = Effect.runSync(
      Effect.exit(Effect.try(() => new LineScanner(options.startLine, options.endLine))),
    );
    if (Exit.isFailure(scanner)) {
      return Promise.resolve(err(new FileError("invalid", "Invalid line range", this.#path)));
    }
    return this.#run(this.#scan(scanner.value, context));
  }

  #scan(
    scanner: nodeBinaryReaderTypes.LineScanner,
    context: Context,
  ): Effect.Effect<resultTypes.Result<typesModule.LineScan, nodeBinaryReaderTypes.FileError>> {
    return Effect.gen({ self: this }, function* () {
      const chunk = new Uint8Array(SCAN_CHUNK);
      let position = 0;
      for (;;) {
        const bytesRead = yield* this.#readAt(chunk, position);
        const afterReadAbort = abortResult<typesModule.LineScan>(context.abortSignal, this.#path);
        if (afterReadAbort !== undefined) return afterReadAbort;
        if (bytesRead === 0) return ok(scanner.finish());
        scanner.push(chunk.subarray(0, bytesRead));
        position += bytesRead;
      }
    });
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    return this.#file.close().catch(() => undefined);
  }
}
