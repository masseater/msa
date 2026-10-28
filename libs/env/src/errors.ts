import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Cause, Effect, Schema } from "effect";
import { dual } from "effect/Function";

import remoteError from "./remote-error.ts";
import type remoteErrorTypes from "./remote-error.types.ts";

const { FileError, err, ok } = env;

const { RemoteError } = remoteError;

const abortResult: {
  (
    path: string | undefined,
  ): <T>(signal: AbortSignal | undefined) => envTypes.Result<T, envTypes.FileError> | undefined;
  <T>(
    signal: AbortSignal | undefined,
    path: string | undefined,
  ): envTypes.Result<T, envTypes.FileError> | undefined;
} = dual(
  2,
  <T>(
    signal: AbortSignal | undefined,
    path: string | undefined,
  ): envTypes.Result<T, envTypes.FileError> | undefined =>
    signal?.aborted === true ? err(FileError.create("aborted", "aborted", path)) : undefined,
);

function remoteFileError(
  error: remoteErrorTypes.RemoteError,
  fallbackPath: string | undefined,
): envTypes.FileError {
  const path = error.path ?? fallbackPath;
  switch (error.code) {
    case "aborted":
      return FileError.create("aborted", error.message, path, error);
    case "ENOENT":
      return FileError.create("not_found", error.message, path, error);
    case "EACCES":
    case "EPERM":
      return FileError.create("permission_denied", error.message, path, error);
    case "ENOTDIR":
      return FileError.create("not_directory", error.message, path, error);
    case "EISDIR":
      return FileError.create("is_directory", error.message, path, error);
    case "EINVAL":
    case "SYMLINK":
    case "NOT_REGULAR":
      return FileError.create("invalid", error.message, path, error);
    default:
      return FileError.create("unknown", error.message, path, error);
  }
}

const toFileError: {
  (fallbackPath: string | undefined): (error: unknown) => envTypes.FileError;
  (error: unknown, fallbackPath: string | undefined): envTypes.FileError;
} = dual(2, (error: unknown, fallbackPath: string | undefined): envTypes.FileError => {
  if (Schema.is(FileError)(error)) return error;
  if (Schema.is(RemoteError)(error)) return remoteFileError(error, fallbackPath);
  const cause = error instanceof Error ? error : new Error(String(error));
  return FileError.create("unknown", cause.message, fallbackPath, cause);
});

const recoverFileError: {
  (
    fallbackPath: string | undefined,
  ): <T>(
    effect: Effect.Effect<envTypes.Result<T, envTypes.FileError>, envTypes.FileError>,
  ) => Effect.Effect<envTypes.Result<T, envTypes.FileError>>;
  <T>(
    effect: Effect.Effect<envTypes.Result<T, envTypes.FileError>, envTypes.FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<envTypes.Result<T, envTypes.FileError>>;
} = dual(
  2,
  <T>(
    effect: Effect.Effect<envTypes.Result<T, envTypes.FileError>, envTypes.FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<envTypes.Result<T, envTypes.FileError>> =>
    Effect.catchCause(effect, (cause) =>
      Effect.succeed(err<T, envTypes.FileError>(toFileError(Cause.squash(cause), fallbackPath))),
    ),
);

const fileResult: {
  (
    fallbackPath: string | undefined,
  ): <T>(
    effect: Effect.Effect<T, envTypes.FileError>,
  ) => Effect.Effect<envTypes.Result<T, envTypes.FileError>>;
  <T>(
    effect: Effect.Effect<T, envTypes.FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<envTypes.Result<T, envTypes.FileError>>;
} = dual(
  2,
  <T>(
    effect: Effect.Effect<T, envTypes.FileError>,
    fallbackPath: string | undefined,
  ): Effect.Effect<envTypes.Result<T, envTypes.FileError>> =>
    recoverFileError(
      Effect.map(effect, (value) => ok<T, envTypes.FileError>(value)),
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
