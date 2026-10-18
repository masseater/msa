import { Cause, Effect, Function, PlatformError } from "effect";

import type { Dual2 } from "../dual.ts";
import { FileError } from "./file-error.ts";
import { err, ok, type Result, toError } from "./result.ts";

export const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
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

export const toFileError: Dual2<unknown, string | undefined, FileError> = Function.dual(
  2,
  (thrown: unknown, fallbackPath: string | undefined): FileError => {
    const error = nodeCause(thrown);
    if (error instanceof FileError) return error;
    const cause = toError(error);
    const nodeError = isNodeError(error) ? error : undefined;
    const path = typeof nodeError?.path === "string" ? nodeError.path : fallbackPath;
    const mapped = nodeError === undefined ? undefined : nodeFileError(nodeError, path, cause);
    return mapped ?? new FileError("unknown", cause.message, path, cause);
  },
);

export const abortResult: {
  (
    path: string | undefined,
  ): <T>(signal: AbortSignal | undefined) => Result<T, FileError> | undefined;
  <T>(signal: AbortSignal | undefined, path: string | undefined): Result<T, FileError> | undefined;
} = Function.dual(
  2,
  <T>(
    signal: AbortSignal | undefined,
    path: string | undefined,
  ): Result<T, FileError> | undefined =>
    signal?.aborted === true ? err(new FileError("aborted", "aborted", path)) : undefined,
);

export const closedResult: {
  (path: string): <T>(what: string) => Result<T, FileError>;
  <T>(what: string, path: string): Result<T, FileError>;
} = Function.dual(2, <T>(what: string, path: string): Result<T, FileError> =>
  err(new FileError("invalid", `${what} is closed`, path)),
);

export const symlinkRefused: Dual2<string, Error | undefined, FileError> = Function.dual(
  2,
  (path: string, cause: Error | undefined): FileError =>
    new FileError("invalid", "Refusing to follow a symbolic link", path, cause),
);

export const recoverFileError = Effect.fnUntraced(function* <T, E, R>(
  effect: Effect.Effect<Result<T, FileError>, E, R>,
  fallbackPath: string | undefined,
) {
  return yield* Effect.catchCause(effect, (cause) =>
    Effect.succeed(err<T, FileError>(toFileError(Cause.squash(cause), fallbackPath))),
  );
});

export const fileResult = Effect.fnUntraced(function* <T, E, R>(
  effect: Effect.Effect<T, E, R>,
  fallbackPath: string | undefined,
) {
  return yield* recoverFileError(
    Effect.map(effect, (value) => ok<T, FileError>(value)),
    fallbackPath,
  );
});
