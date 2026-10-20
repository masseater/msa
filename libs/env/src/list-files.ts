import type { Context } from "@msa/chord";
import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type connectionTypes from "./connection.types.ts";
import errors from "./errors.ts";

const { FileError, err, ok } = env;

const { abortResult, recoverFileError } = errors;

const KINDS: Record<number, envTypes.FileKind> = { 100: "directory", 102: "file", 108: "symlink" };

function invalidLimit(
  options: envTypes.ListFilesOptions | undefined,
  path: string,
): envTypes.Result<envTypes.FileListing, envTypes.FileError> | undefined {
  for (const key of ["maxEntries", "maxBytes", "timeoutMs"] as const) {
    const value = options?.[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      return err(new FileError("invalid", `${key} must be a non-negative safe integer`, path));
    }
  }
  return undefined;
}

function parseListing(payload: Uint8Array): envTypes.FileListEntry[] {
  const entries: envTypes.FileListEntry[] = [];
  const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.length);
  for (let start = 0; start < bytes.length;) {
    const end = bytes.indexOf(0, start);
    if (end === -1) break;
    const kind = KINDS[bytes[start]!];
    if (kind !== undefined) entries.push({ kind, path: bytes.toString("utf8", start + 1, end) });
    start = end + 1;
  }
  return entries;
}

function requestListing(
  connection: connectionTypes.Connection,
  path: string,
  options: envTypes.ListFilesOptions | undefined,
  context: Context,
): Effect.Effect<envTypes.Result<envTypes.FileListing, envTypes.FileError>> {
  return Effect.gen(function* () {
    const info = yield* Effect.promise(() => connection.info());
    if (info.features?.includes("listFiles") !== true) {
      return err<envTypes.FileListing, envTypes.FileError>(
        new FileError("not_supported", "The msa-env daemon does not list files; update it", path),
      );
    }
    const { json, payload } = yield* Effect.promise(() =>
      connection.request(
        "listFiles",
        {
          exclude: options?.exclude,
          gitignore: options?.gitignore,
          hidden: options?.hidden,
          maxBytes: options?.maxBytes,
          maxEntries: options?.maxEntries,
          path,
          timeoutMs: options?.timeoutMs,
        },
        context.abortSignal === undefined ? {} : { signal: context.abortSignal },
      ),
    );
    const afterAbort = abortResult<envTypes.FileListing>(context.abortSignal, path);
    if (afterAbort !== undefined) return afterAbort;
    return ok<envTypes.FileListing, envTypes.FileError>({
      entries: parseListing(payload),
      truncated: json["truncated"] === true,
    });
  });
}

const listFilesEffect = (
  connection: connectionTypes.Connection,
  path: string,
  options: envTypes.ListFilesOptions | undefined,
  context: Context,
): Effect.Effect<envTypes.Result<envTypes.FileListing, envTypes.FileError>> => {
  const invalid = invalidLimit(options, path);
  if (invalid !== undefined) return Effect.succeed(invalid);
  const aborted = abortResult<envTypes.FileListing>(context.abortSignal, path);
  if (aborted !== undefined) return Effect.succeed(aborted);
  return recoverFileError(requestListing(connection, path, options, context), path);
};

const listFilesOver: {
  (
    path: string,
    options: envTypes.ListFilesOptions | undefined,
    context: Context,
  ): (
    connection: connectionTypes.Connection,
  ) => Promise<envTypes.Result<envTypes.FileListing, envTypes.FileError>>;
  (
    connection: connectionTypes.Connection,
    path: string,
    options: envTypes.ListFilesOptions | undefined,
    context: Context,
  ): Promise<envTypes.Result<envTypes.FileListing, envTypes.FileError>>;
} = dual(
  4,
  (
    connection: connectionTypes.Connection,
    path: string,
    options: envTypes.ListFilesOptions | undefined,
    context: Context,
  ): Promise<envTypes.Result<envTypes.FileListing, envTypes.FileError>> =>
    Effect.runPromise(listFilesEffect(connection, path, options, context)),
);

const listFilesModule = {
  listFilesEffect,
  listFilesOver,
};

export default listFilesModule;
