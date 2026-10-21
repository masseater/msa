import { Cause, Effect, Function, PlatformError } from "effect";

import type dualTypes from "../../dual.ts";
import FileError from "../file-error.ts";
import type fileErrorTypes from "../file-error.types.ts";
import resultModule from "../result.ts";
import type resultTypes from "../result.types.ts";

const { err, ok, toError } = resultModule;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const nodeCause = (error: unknown): unknown =>
  error instanceof PlatformError.PlatformError && error.cause !== undefined ? error.cause : error;

const nodeFileError = (error: NodeJS.ErrnoException, path: string | undefined, cause: Error) => {
  const message = error.message;
  switch (error.code) {
    case "ABORT_ERR":
      return new FileError("aborted", message, path, cause);
    case "ENOENT":
      return new FileError("not_found", message, path, cause);
    case "EACCES":
    case "EPERM":
      return new FileError("permission_denied", message, path, cause);
    case "ENOTDIR":
      return new FileError("not_directory", message, path, cause);
    case "EISDIR":
      return new FileError("is_directory", message, path, cause);
    case "EINVAL":
      return new FileError("invalid", message, path, cause);
    default:
      return undefined;
  }
};

const toFileError: dualTypes.Dual2<unknown, string | undefined, fileErrorTypes.FileError> =
  Function.dual(
    2,
    (thrown: unknown, fallbackPath: string | undefined): fileErrorTypes.FileError => {
      const error = nodeCause(thrown);
      if (error instanceof FileError) return error;
      const cause = toError(error);
      const nodeError = isNodeError(error) ? error : undefined;
      const path = typeof nodeError?.path === "string" ? nodeError.path : fallbackPath;
      const mapped = nodeError === undefined ? undefined : nodeFileError(nodeError, path, cause);
      return mapped ?? new FileError("unknown", cause.message, path, cause);
    },
  );

const abortResult: {
  (
    path: string | undefined,
  ): <T>(
    signal: AbortSignal | undefined,
  ) => resultTypes.Result<T, fileErrorTypes.FileError> | undefined;
  <T>(
    signal: AbortSignal | undefined,
    path: string | undefined,
  ): resultTypes.Result<T, fileErrorTypes.FileError> | undefined;
} = Function.dual(
  2,
  <T>(
    signal: AbortSignal | undefined,
    path: string | undefined,
  ): resultTypes.Result<T, fileErrorTypes.FileError> | undefined =>
    signal?.aborted === true ? err(new FileError("aborted", "aborted", path)) : undefined,
);

const closedResult: {
  (path: string): <T>(what: string) => resultTypes.Result<T, fileErrorTypes.FileError>;
  <T>(what: string, path: string): resultTypes.Result<T, fileErrorTypes.FileError>;
} = Function.dual(
  2,
  <T>(what: string, path: string): resultTypes.Result<T, fileErrorTypes.FileError> =>
    err(new FileError("invalid", `${what} is closed`, path)),
);

const symlinkRefused: dualTypes.Dual2<string, Error | undefined, fileErrorTypes.FileError> =
  Function.dual(
    2,
    (path: string, cause: Error | undefined): fileErrorTypes.FileError =>
      new FileError("invalid", "Refusing to follow a symbolic link", path, cause),
  );

const recoverFileError = Effect.fnUntraced(function* <T, E, R>(
  effect: Effect.Effect<resultTypes.Result<T, fileErrorTypes.FileError>, E, R>,
  fallbackPath: string | undefined,
) {
  return yield* Effect.catchCause(effect, (cause) =>
    Effect.succeed(
      err<T, fileErrorTypes.FileError>(toFileError(Cause.squash(cause), fallbackPath)),
    ),
  );
});

const fileResult = Effect.fnUntraced(function* <T, E, R>(
  effect: Effect.Effect<T, E, R>,
  fallbackPath: string | undefined,
) {
  return yield* recoverFileError(
    Effect.map(effect, (value) => ok<T, fileErrorTypes.FileError>(value)),
    fallbackPath,
  );
});

const nodeErrors = {
  abortResult,
  closedResult,
  fileResult,
  isNodeError,
  recoverFileError,
  symlinkRefused,
  toFileError,
};

export default nodeErrors;
