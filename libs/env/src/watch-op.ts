import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";

import errors from "./errors.ts";
import fileOp from "./file-op.ts";
import type watchOpTypes from "./watch-op.types.ts";
import RemoteWatcher from "./watch.ts";

const { ok } = env;

const { abortResult, recoverFileError } = errors;
const { resolveIn, run } = fileOp;

const watchIn = (
  request: watchOpTypes.WatchRequest,
): Promise<envTypes.Result<envTypes.FileWatcher, envTypes.FileError>> => {
  const { target, context } = request;
  const aborted = abortResult<envTypes.FileWatcher>(context.abortSignal, undefined);
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
        const afterResolve = abortResult<envTypes.FileWatcher>(context.abortSignal, undefined);
        if (afterResolve !== undefined) return afterResolve;
        const watcher = yield* Effect.promise(() =>
          RemoteWatcher.open(target.connection, resolved, request.onChange, request.options),
        );
        const afterOpen = abortResult<envTypes.FileWatcher>(context.abortSignal, undefined);
        if (afterOpen !== undefined) {
          yield* Effect.promise(() => watcher.close(context));
          return afterOpen;
        }
        return ok<envTypes.FileWatcher, envTypes.FileError>(watcher);
      }),
      undefined,
    ),
  );
};

const watchOp = {
  watchIn,
};

export default watchOp;
