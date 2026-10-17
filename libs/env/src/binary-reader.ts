import type { Context } from "@msa/chord";
import {
  type BinaryReader,
  err,
  FileError,
  type FileInfo,
  type LineScan,
  ok,
  type Result,
} from "@msa/durable/env";
import { Effect } from "effect";

import { abortResult, fileResult, recoverFileError } from "./errors.ts";
import type { Handle } from "./handle.ts";
import { concat, readRange } from "./read-range.ts";
import type { Wire } from "./remote-error.ts";
import { remoteFileInfo, remotePath, toInfo } from "./remote-path.ts";

const READ_CHUNK = 256 * 1024;

const isNonNegativeSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export class RemoteBinaryReader implements BinaryReader {
  readonly #handle: Handle;
  #closed = false;

  constructor(handle: Handle) {
    this.#handle = handle;
  }

  get #path(): string {
    return this.#handle.path;
  }

  #early<T>(context: Context): Result<T, FileError> | undefined {
    const aborted = abortResult<T>(context.abortSignal, this.#path);
    if (aborted !== undefined) return aborted;
    return this.#closed
      ? err(new FileError("invalid", "Binary reader is closed", this.#path))
      : undefined;
  }

  info(context: Context): Promise<Result<FileInfo, FileError>> {
    const early = this.#early<FileInfo>(context);
    if (early !== undefined) return Promise.resolve(early);
    const handle = this.#handle;
    return Effect.runPromise(
      recoverFileError(
        Effect.gen(function* () {
          const { json } = yield* Effect.promise(() => handle.request("fstat"));
          const paths = yield* remotePath(handle.connection);
          return toInfo(handle.path, remoteFileInfo(json), paths);
        }),
        this.#path,
      ),
    );
  }

  read(offset: number, length: number, context: Context): Promise<Result<Uint8Array, FileError>> {
    const early = this.#early<Uint8Array>(context);
    if (early !== undefined) return Promise.resolve(early);
    if (!isNonNegativeSafeInteger(offset) || !isNonNegativeSafeInteger(length)) {
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
    const handle = this.#handle;
    return Effect.runPromise(
      recoverFileError(
        readRange({
          read: (at, size) => handle.pread(at, size),
          offset,
          length,
          chunk: READ_CHUNK,
          aborted: () => context.abortSignal?.aborted === true,
        }).pipe(
          Effect.map((read) =>
            read === undefined
              ? err<Uint8Array, FileError>(new FileError("aborted", "aborted", handle.path))
              : ok<Uint8Array, FileError>(concat(read.chunks, read.total)),
          ),
        ),
        this.#path,
      ),
    );
  }

  scanLines(
    options: { startLine: number; endLine?: number },
    context: Context,
  ): Promise<Result<LineScan, FileError>> {
    const early = this.#early<LineScan>(context);
    if (early !== undefined) return Promise.resolve(early);
    const { startLine, endLine } = options;
    if (
      !isNonNegativeSafeInteger(startLine) ||
      (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine <= startLine))
    ) {
      return Promise.resolve(err(new FileError("invalid", "Invalid line range", this.#path)));
    }
    const handle = this.#handle;
    return Effect.runPromise(
      fileResult(
        Effect.promise(() =>
          handle.request(
            "scanLines",
            { startLine, ...(endLine === undefined ? {} : { endLine }) },
            context.abortSignal === undefined ? {} : { signal: context.abortSignal },
          ),
        ).pipe(Effect.map(({ json }) => json as Wire<LineScan>)),
        this.#path,
      ),
    );
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    return this.#handle.close();
  }
}
