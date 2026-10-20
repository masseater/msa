import { FileError, type Result, err, ok } from "@msa/durable/env";
import { Cause, Effect } from "effect";
import { dual } from "effect/Function";

import remoteError from "./remote-error.ts";
import type remoteErrorTypes from "./remote-error.types.ts";

const { RemoteError } = remoteError;

const abortResult: {
  (
    path: string | undefined,
  ): <T>(signal: AbortSignal | undefined) => Result<T, FileError> | undefined;
  <T>(signal: AbortSignal | undefined, path: string | undefined): Result<T, FileError> | undefined;
} = dual(
  2,
  <T>(
    signal: AbortSignal | undefined,
    path: string | undefined,
  ): Result<T, FileError> | undefined =>
    signal?.aborted === true ? err(new FileError("aborted", "aborted", path)) : undefined,
);

function remoteFileError(
  error: remoteErrorTypes.RemoteError,
  fallbackPath: string | undefined,
): FileError {
  const path = error.path ?? fallbackPath;
  switch (error.code) {
    case "aborted":
      return new FileError("aborted", error.message, path, error);
    case "ENOENT":
      return new FileError("not_found", error.message, path, error);
    case "EACCES":
    case "EPERM":
      return new FileError("permission_denied", error.message, path, error);
    case "ENOTDIR":
      return new FileError("not_directory", error.message, path, error);
    case "EISDIR":
      return new FileError("is_directory", error.message, path, error);
    case "EINVAL":
    case "SYMLINK":
    case "NOT_REGULAR":
      return new FileError("invalid", error.message, path, error);
    default:
      return new FileError("unknown", error.message, path, error);
  }
}

const toFileError: {
  (fallbackPath: string | undefined): (error: unknown) => FileError;
  (error: unknown, fallbackPath: string | undefined): FileError;
} = dual(2, (error: unknown, fallbackPath: string | undefined): FileError => {
  if (error instanceof FileError) return error;
  if (error instanceof RemoteError) return remoteFileError(error, fallbackPath);
  const cause = error instanceof Error ? error : new Error(String(error));
  return new FileError("unknown", cause.message, fallbackPath, cause);
});

const recoverFileError: {
  (
    fallbackPath: string | undefined,
  ): <T>(
    effect: Effect.Effect<Result<T, FileError>, FileError>,
  ) => Effect.Effect<Result<T, FileError>>;
  <T>(
    effect: Effect.Effect<Result<T, FileError>, FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<Result<T, FileError>>;
} = dual(
  2,
  <T>(
    effect: Effect.Effect<Result<T, FileError>, FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<Result<T, FileError>> =>
    Effect.catchCause(effect, (cause) =>
      Effect.succeed(err<T, FileError>(toFileError(Cause.squash(cause), fallbackPath))),
    ),
);

const fileResult: {
  (
    fallbackPath: string | undefined,
  ): <T>(effect: Effect.Effect<T, FileError>) => Effect.Effect<Result<T, FileError>>;
  <T>(
    effect: Effect.Effect<T, FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<Result<T, FileError>>;
} = dual(
  2,
  <T>(
    effect: Effect.Effect<T, FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<Result<T, FileError>> =>
    recoverFileError(
      Effect.map(effect, (value) => ok<T, FileError>(value)),
      fallbackPath,
    ),
);

const errors = {
  abortResult,
  fileResult,
  recoverFileError,
  toFileError,
};

export default errors;
