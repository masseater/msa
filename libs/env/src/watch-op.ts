import type { Context } from "@msa/chord";
import {
  type FileError,
  type FileWatcher,
  ok,
  type Result,
  type WatchChange,
  type WatchTarget,
} from "@msa/durable/env";
import { Effect } from "effect";

import { abortResult, recoverFileError } from "./errors.ts";
import { type RemoteTarget, resolveIn, run } from "./file-op.ts";
import { RemoteWatcher, type RemoteWatchOptions } from "./watch.ts";

export interface WatchRequest {
  readonly target: RemoteTarget;
  readonly targets: readonly WatchTarget[];
  readonly onChange: (change: WatchChange) => void;
  readonly options: RemoteWatchOptions;
  readonly context: Context;
}

export const watchIn = (request: WatchRequest): Promise<Result<FileWatcher, FileError>> => {
  const { target, context } = request;
  const aborted = abortResult<FileWatcher>(context.abortSignal, undefined);
  if (aborted !== undefined) return Promise.resolve(aborted);
  return run(
    recoverFileError(
      Effect.gen(function* () {
        const resolved = yield* Effect.forEach(
          request.targets,
          (watched) =>
            resolveIn({ target, path: watched.path }).pipe(
              Effect.map((path) => ({ ...watched, path })),
            ),
          { concurrency: "unbounded" },
        );
        const afterResolve = abortResult<FileWatcher>(context.abortSignal, undefined);
        if (afterResolve !== undefined) return afterResolve;
        const watcher = yield* Effect.promise(() =>
          RemoteWatcher.open(target.connection, resolved, request.onChange, request.options),
        );
        const afterOpen = abortResult<FileWatcher>(context.abortSignal, undefined);
        if (afterOpen !== undefined) {
          yield* Effect.promise(() => watcher.close(context));
          return afterOpen;
        }
        return ok<FileWatcher, FileError>(watcher);
      }),
      undefined,
    ),
  );
};
