import type { Context } from "@msa/chord";
import {
  type ExecutionEnv,
  FileError,
  type FileKind,
  type FileListEntry,
  type FileListing,
  type ListFilesOptions,
  type Result,
  err,
  ok,
} from "@msa/durable/env";
import { NodeExecutionEnv } from "@msa/durable/env/node";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type connectionTypes from "./connection.types.ts";
import errors from "./errors.ts";
import type listFilesTypes from "./list-files.types.ts";

const { abortResult, recoverFileError } = errors;

const KINDS: Record<number, FileKind> = { 100: "directory", 102: "file", 108: "symlink" };

function invalidLimit(
  options: ListFilesOptions | undefined,
  path: string,
): Result<FileListing, FileError> | undefined {
  for (const key of ["maxEntries", "maxBytes", "timeoutMs"] as const) {
    const value = options?.[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      return err(new FileError("invalid", `${key} must be a non-negative safe integer`, path));
    }
  }
  return undefined;
}

function parseListing(payload: Uint8Array): FileListEntry[] {
  const entries: FileListEntry[] = [];
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
  options: ListFilesOptions | undefined,
  context: Context,
): Effect.Effect<Result<FileListing, FileError>> {
  return Effect.gen(function* () {
    const info = yield* Effect.promise(() => connection.info());
    if (info.features?.includes("listFiles") !== true) {
      return err<FileListing, FileError>(
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
    const afterAbort = abortResult<FileListing>(context.abortSignal, path);
    if (afterAbort !== undefined) return afterAbort;
    return ok<FileListing, FileError>({
      entries: parseListing(payload),
      truncated: json["truncated"] === true,
    });
  });
}

const listFilesEffect = (
  connection: connectionTypes.Connection,
  path: string,
  options: ListFilesOptions | undefined,
  context: Context,
): Effect.Effect<Result<FileListing, FileError>> => {
  const invalid = invalidLimit(options, path);
  if (invalid !== undefined) return Effect.succeed(invalid);
  const aborted = abortResult<FileListing>(context.abortSignal, path);
  if (aborted !== undefined) return Effect.succeed(aborted);
  return recoverFileError(requestListing(connection, path, options, context), path);
};

const listFilesOver: {
  (
    path: string,
    options: ListFilesOptions | undefined,
    context: Context,
  ): (connection: connectionTypes.Connection) => Promise<Result<FileListing, FileError>>;
  (
    connection: connectionTypes.Connection,
    path: string,
    options: ListFilesOptions | undefined,
    context: Context,
  ): Promise<Result<FileListing, FileError>>;
} = dual(
  4,
  (
    connection: connectionTypes.Connection,
    path: string,
    options: ListFilesOptions | undefined,
    context: Context,
  ): Promise<Result<FileListing, FileError>> =>
    Effect.runPromise(listFilesEffect(connection, path, options, context)),
);

class LocalExecutionEnv extends NodeExecutionEnv implements ExecutionEnv {
  readonly #connection: connectionTypes.Connection;

  constructor(options: listFilesTypes.LocalExecutionEnvOptions) {
    const { connection, ...node } = options;
    super(node);
    this.#connection = connection;
  }

  listFiles(
    path: string,
    options: ListFilesOptions | undefined,
    context: Context,
  ): Promise<Result<FileListing, FileError>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const resolved = yield* Effect.promise(() => this.absolutePath(path, context));
        if (!resolved.ok) return resolved;
        return yield* listFilesEffect(this.#connection, resolved.value, options, context);
      }),
    );
  }
}

const listFilesModule = {
  LocalExecutionEnv,
  listFilesOver,
};

export default listFilesModule;
