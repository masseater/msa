import type { Context } from "@msa/chord";
import { type DirReader, err, FileError, type FileInfo, ok, type Result } from "@msa/durable/env";
import { Effect } from "effect";

import { RemoteError } from "./connection.ts";
import { abortResult, recoverFileError, toFileError } from "./errors.ts";
import type { Handle } from "./handle.ts";
import type { PathOps } from "./platform.ts";
import { type RemoteDirEntry, remotePath, toInfo } from "./remote-path.ts";

type Batch = { entries: FileInfo[]; done: boolean };

function collectEntries(
  entries: FileInfo[],
  batch: readonly RemoteDirEntry[],
  path: string,
  paths: PathOps,
): Result<Batch, FileError> | undefined {
  for (const entry of batch) {
    const entryPath = paths.resolve(path, entry.name);
    if (entry.error !== undefined) {
      if (entry.error["code"] === "ENOENT") continue;
      return err(toFileError(new RemoteError(entry.error), entryPath));
    }
    const info = toInfo(entryPath, entry.info!, paths);
    if (info.ok) entries.push(info.value);
  }
  return undefined;
}

export class RemoteDirReader implements DirReader {
  readonly #handle: Handle;
  #done = false;
  #closed = false;

  constructor(handle: Handle) {
    this.#handle = handle;
  }

  next(maxEntries: number, context: Context): Promise<Result<Batch, FileError>> {
    const path = this.#handle.path;
    const aborted = abortResult<Batch>(context.abortSignal, path);
    if (aborted !== undefined) return Promise.resolve(aborted);
    if (this.#closed) {
      return Promise.resolve(err(new FileError("invalid", "Directory reader is closed", path)));
    }
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      return Promise.resolve(
        err(new FileError("invalid", "maxEntries must be a positive safe integer", path)),
      );
    }
    return Effect.runPromise(recoverFileError(this.#read(maxEntries, context), path));
  }

  #read(maxEntries: number, context: Context): Effect.Effect<Result<Batch, FileError>> {
    return Effect.gen({ self: this }, function* () {
      const handle = this.#handle;
      const entries: FileInfo[] = [];
      const paths = yield* remotePath(handle.connection);
      while (!this.#done && entries.length < maxEntries) {
        const { json } = yield* Effect.promise(() =>
          handle.request("readdir", { max: maxEntries - entries.length }),
        );
        const loopAbort = abortResult<Batch>(context.abortSignal, handle.path);
        if (loopAbort !== undefined) return loopAbort;
        const failed = collectEntries(
          entries,
          json["entries"] as RemoteDirEntry[],
          handle.path,
          paths,
        );
        if (failed !== undefined) return failed;
        this.#done = json["done"] === true;
      }
      return ok<Batch, FileError>({ entries, done: this.#done });
    });
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    return this.#handle.close();
  }
}
