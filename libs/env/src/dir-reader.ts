import type { Context } from "@msa/chord";
import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";

import connectionModule from "./connection.ts";
import errors from "./errors.ts";
import type handleTypes from "./handle.types.ts";
import type platformTypes from "./platform.types.ts";
import remotePathModule from "./remote-path.ts";
import type remotePathTypes from "./remote-path.types.ts";

const { FileError, err, ok } = env;

const { abortResult, recoverFileError, toFileError } = errors;
const { RemoteError } = connectionModule;
const { remotePath, toInfo } = remotePathModule;

type Batch = { entries: envTypes.FileInfo[]; done: boolean };

function collectEntries(
  entries: envTypes.FileInfo[],
  batch: readonly remotePathTypes.RemoteDirEntry[],
  path: string,
  paths: platformTypes.PathOps,
): envTypes.Result<Batch, envTypes.FileError> | undefined {
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

export default class RemoteDirReader implements envTypes.DirReader {
  readonly #handle: handleTypes.Handle;
  #done = false;
  #closed = false;

  constructor(handle: handleTypes.Handle) {
    this.#handle = handle;
  }

  next(maxEntries: number, context: Context): Promise<envTypes.Result<Batch, envTypes.FileError>> {
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

  #read(
    maxEntries: number,
    context: Context,
  ): Effect.Effect<envTypes.Result<Batch, envTypes.FileError>> {
    return Effect.gen({ self: this }, function* () {
      const handle = this.#handle;
      const entries: envTypes.FileInfo[] = [];
      const paths = yield* remotePath(handle.connection);
      while (!this.#done && entries.length < maxEntries) {
        const { json } = yield* Effect.promise(() =>
          handle.request("readdir", { max: maxEntries - entries.length }),
        );
        const loopAbort = abortResult<Batch>(context.abortSignal, handle.path);
        if (loopAbort !== undefined) return loopAbort;
        const failed = collectEntries(
          entries,
          json["entries"] as remotePathTypes.RemoteDirEntry[],
          handle.path,
          paths,
        );
        if (failed !== undefined) return failed;
        this.#done = json["done"] === true;
      }
      return ok<Batch, envTypes.FileError>({ done: this.#done, entries });
    });
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    return this.#handle.close();
  }
}
