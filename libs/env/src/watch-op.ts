import { type FileError, type FileWatcher, type Result, ok } from "@msa/durable/env";
import { Effect } from "effect";

import errors from "./errors.ts";
import fileOp from "./file-op.ts";
import type watchOpTypes from "./watch-op.types.ts";
import watch from "./watch.ts";

const { abortResult, recoverFileError } = errors;
const { resolveIn, run } = fileOp;
const { RemoteWatcher } = watch;

const watchIn = (request: watchOpTypes.WatchRequest): Promise<Result<FileWatcher, FileError>> => {
  const { target, context } = request;
  const aborted = abortResult<FileWatcher>(context.abortSignal, undefined);
  if (aborted !== undefined) return Promise.resolve(aborted);
  return run(
    recoverFileError(
      Effect.gen(function* () {
        const resolved = yield* Effect.forEach(
          request.targets,
          (watched) =>
            resolveIn({ path: watched.path, target }).pipe(
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

const watchOp = {
  watchIn,
};

export default watchOp;
