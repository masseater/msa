import { FileError, type Result } from "@msa/durable/env";
import { Effect } from "effect";

import { abortResult, fileResult } from "./errors.ts";
import { type PathRequest, remoteRequest, resolveIn, run, runFileOp } from "./file-op.ts";
import { writeContent } from "./write-file.ts";

export interface WriteRequest extends PathRequest {
  readonly content: string | Uint8Array;
  readonly append: boolean;
}

export interface TruncateRequest extends PathRequest {
  readonly size: number;
}

export interface RenameRequest extends PathRequest {
  readonly destination: string;
}

export interface CreateDirRequest extends PathRequest {
  readonly recursive: boolean;
}

export interface RemoveRequest extends PathRequest {
  readonly recursive: boolean;
  readonly force: boolean;
}

export const writeAt = (request: WriteRequest): Promise<Result<void, FileError>> => {
  const { content, append } = request;
  const { connection } = request.target;
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const signal = append ? undefined : request.context.abortSignal;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) => writeContent({ connection, resolved, bytes, append, signal }),
      check: append ? "both" : "before",
    }),
  );
};

export const truncateAt = (request: TruncateRequest): Promise<Result<void, FileError>> => {
  const { size } = request;
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        !Number.isSafeInteger(size) || size < 0
          ? Effect.fail(
              new FileError("invalid", "File size must be a non-negative safe integer", resolved),
            )
          : Effect.asVoid(
              remoteRequest({ connection, op: "truncate", json: { path: resolved, size } }),
            ),
      check: "both",
    }),
  );
};

export const flushAt = (request: PathRequest): Promise<Result<void, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.asVoid(remoteRequest({ connection, op: "fsync", json: { path: resolved } })),
      check: "both",
    }),
  );
};

export const renameAt = (request: RenameRequest): Promise<Result<void, FileError>> => {
  const { target, path, context } = request;
  return run(
    Effect.gen(function* () {
      const resolved = yield* fileResult(
        Effect.all([resolveIn({ target, path }), resolveIn({ target, path: request.destination })]),
        path,
      );
      if (!resolved.ok) return resolved;
      const [source, destination] = resolved.value;
      const aborted = abortResult<void>(context.abortSignal, destination);
      if (aborted !== undefined) return aborted;
      return yield* fileResult(
        Effect.asVoid(
          remoteRequest({
            connection: target.connection,
            op: "rename",
            json: { path: source, to: destination },
          }),
        ),
        source,
      );
    }),
  );
};

export const createDirAt = (request: CreateDirRequest): Promise<Result<void, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.asVoid(
          remoteRequest({
            connection,
            op: "mkdir",
            json: { path: resolved, recursive: request.recursive },
          }),
        ),
    }),
  );
};

export const removeAt = (request: RemoveRequest): Promise<Result<void, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.asVoid(
          remoteRequest({
            connection,
            op: "rm",
            json: { path: resolved, recursive: request.recursive, force: request.force },
          }),
        ),
    }),
  );
};
