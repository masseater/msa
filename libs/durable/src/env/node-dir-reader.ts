import type { Context } from "@msa/chord";
import { Cause, Effect } from "effect";

import { FileError } from "./file-error.ts";
import {
  abortResult,
  closedResult,
  isNodeError,
  recoverFileError,
  toFileError,
} from "./node-errors.ts";
import { childPath, fileInfoFromStats, type StatsLike } from "./node-paths.ts";
import { err, ok, type Result } from "./result.ts";
import type { DirReader, FileInfo } from "./types.ts";

type DirBatch = { entries: FileInfo[]; done: boolean };

export interface ReadableDir {
  read(): Promise<{ readonly name: string } | null>;
  close(): Promise<void>;
}

export type LinkStat = (path: string) => Promise<StatsLike>;

const entryStats = (lstat: LinkStat, path: string) =>
  Effect.matchCauseEffect(
    Effect.promise(() => lstat(path)),
    {
      onSuccess: (stats) => Effect.succeed(ok<StatsLike | undefined, FileError>(stats)),
      onFailure: (cause) => {
        const error = Cause.squash(cause);
        return isNodeError(error) && error.code === "ENOENT"
          ? Effect.succeed(ok<StatsLike | undefined, FileError>(undefined))
          : Effect.succeed(err<StatsLike | undefined, FileError>(toFileError(error, path)));
      },
    },
  );

export class NodeDirReader implements DirReader {
  readonly #dir: ReadableDir;
  readonly #path: string;
  readonly #lstat: LinkStat;
  #done = false;
  #closed = false;

  constructor(dir: ReadableDir, path: string, lstat: LinkStat) {
    this.#dir = dir;
    this.#path = path;
    this.#lstat = lstat;
  }

  next(maxEntries: number, context: Context): Promise<Result<DirBatch, FileError>> {
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

  #fill(maxEntries: number, context: Context): Effect.Effect<Result<DirBatch, FileError>> {
    return Effect.gen({ self: this }, function* () {
      const entries: FileInfo[] = [];
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
        if (!stats.ok) return err<DirBatch, FileError>(stats.error);
        if (stats.value !== undefined) {
          const info = fileInfoFromStats(entryPath, stats.value);
          if (info.ok) entries.push(info.value);
        }
      }
      return ok({ entries, done: this.#done });
    });
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    return this.#dir.close().catch(() => undefined);
  }
}
