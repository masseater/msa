import type chordTypes from "@msa/chord/index.types";
import { Cause, Effect } from "effect";

import FileError from "../file-error.ts";
import resultModule from "../result.ts";
import type resultTypes from "../result.types.ts";
import type typesModule from "../types.ts";
import type nodeDirReaderTypes from "./node-dir-reader.types.ts";
import nodeErrors from "./node-errors.ts";
import nodePaths from "./node-paths.ts";
import type nodePathsTypes from "./node-paths.types.ts";

const { abortResult, closedResult, isNodeError, recoverFileError, toFileError } = nodeErrors;
const { err, ok } = resultModule;

const { childPath, fileInfoFromStats } = nodePaths;

type DirBatch = { entries: typesModule.FileInfo[]; done: boolean };

const entryStats = (lstat: nodeDirReaderTypes.LinkStat, path: string) =>
  Effect.matchCauseEffect(
    Effect.promise(() => lstat(path)),
    {
      onFailure: (cause) => {
        const error = Cause.squash(cause);
        return isNodeError(error) && error.code === "ENOENT"
          ? Effect.succeed(
              ok<nodePathsTypes.StatsLike | undefined, nodeDirReaderTypes.FileError>(undefined),
            )
          : Effect.succeed(
              err<nodePathsTypes.StatsLike | undefined, nodeDirReaderTypes.FileError>(
                toFileError(error, path),
              ),
            );
      },
      onSuccess: (stats) =>
        Effect.succeed(
          ok<nodePathsTypes.StatsLike | undefined, nodeDirReaderTypes.FileError>(stats),
        ),
    },
  );

export default class NodeDirReader implements typesModule.DirReader {
  readonly #dir: nodeDirReaderTypes.ReadableDir;
  readonly #path: string;
  readonly #lstat: nodeDirReaderTypes.LinkStat;
  #done = false;
  #closed = false;

  constructor(
    dir: nodeDirReaderTypes.ReadableDir,
    path: string,
    lstat: nodeDirReaderTypes.LinkStat,
  ) {
    this.#dir = dir;
    this.#path = path;
    this.#lstat = lstat;
  }

  next(
    maxEntries: number,
    context: chordTypes.Context,
  ): Promise<resultTypes.Result<DirBatch, nodeDirReaderTypes.FileError>> {
    const aborted = abortResult<DirBatch>(context.abortSignal, this.#path);
    if (aborted !== undefined) return Promise.resolve(aborted);
    if (this.#closed)
      return Promise.resolve(closedResult<DirBatch>("Directory reader", this.#path));
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      return Promise.resolve(
        err(new FileError("invalid", "maxEntries must be a positive safe integer", this.#path)),
      );
    }
    return Effect.runPromise(recoverFileError(this.#fill(maxEntries, context), this.#path));
  }

  #fill(
    maxEntries: number,
    context: chordTypes.Context,
  ): Effect.Effect<resultTypes.Result<DirBatch, nodeDirReaderTypes.FileError>> {
    return Effect.gen({ self: this }, function* () {
      const entries: typesModule.FileInfo[] = [];
      while (!this.#done && entries.length < maxEntries) {
        const entry = yield* Effect.promise(() => this.#dir.read());
        if (entry === null) {
          this.#done = true;
          break;
        }
        const loopAbort = abortResult<DirBatch>(context.abortSignal, this.#path);
        if (loopAbort !== undefined) return loopAbort;
        const entryPath = childPath(this.#path, entry.name);
        const stats = yield* entryStats(this.#lstat, entryPath);
        if (!stats.ok) return err<DirBatch, nodeDirReaderTypes.FileError>(stats.error);
        if (stats.value !== undefined) {
          const info = fileInfoFromStats(entryPath, stats.value);
          if (info.ok) entries.push(info.value);
        }
      }
      return ok({ done: this.#done, entries });
    });
  }

  close(_context: chordTypes.Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    return this.#dir.close().catch(() => undefined);
  }
}
