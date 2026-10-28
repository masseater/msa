import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";

import errors from "./errors.ts";
import fileOp from "./file-op.ts";
import type fileOpTypes from "./file-op.types.ts";
import type mutateOpsTypes from "./mutate-ops.types.ts";
import writeFile from "./write-file.ts";

const { FileError } = env;

const { remoteRequest, resolveIn, run, runFileOp } = fileOp;
const { writeContent } = writeFile;
const { abortResult, fileResult } = errors;

const writeAt = (
  request: mutateOpsTypes.WriteRequest,
): Promise<envTypes.Result<void, envTypes.FileError>> => {
  const { content, append } = request;
  const { connection } = request.target;
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const signal = append ? undefined : request.context.abortSignal;
  return run(
    runFileOp({
      ...request,
      check: append ? "both" : "before",
      operation: (resolved) => writeContent({ append, bytes, connection, resolved, signal }),
    }),
  );
};

const truncateAt = (
  request: mutateOpsTypes.TruncateRequest,
): Promise<envTypes.Result<void, envTypes.FileError>> => {
  const { size } = request;
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      check: "both",
      operation: (resolved) =>
        !Number.isSafeInteger(size) || size < 0
          ? Effect.fail(
              FileError.create(
                "invalid",
                "File size must be a non-negative safe integer",
                resolved,
              ),
            )
          : Effect.asVoid(
              remoteRequest({ connection, json: { path: resolved, size }, op: "truncate" }),
            ),
    }),
  );
};

const flushAt = (
  request: fileOpTypes.PathRequest,
): Promise<envTypes.Result<void, envTypes.FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      check: "both",
      operation: (resolved) =>
        Effect.asVoid(remoteRequest({ connection, json: { path: resolved }, op: "fsync" })),
    }),
  );
};

const renameAt = (
  request: mutateOpsTypes.RenameRequest,
): Promise<envTypes.Result<void, envTypes.FileError>> => {
  const { target, path, context } = request;
  return run(
    Effect.gen(function* () {
      const resolved = yield* fileResult(
        Effect.all([resolveIn({ path, target }), resolveIn({ path: request.destination, target })]),
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
            json: { path: source, to: destination },
            op: "rename",
          }),
        ),
        source,
      );
    }),
  );
};

const createDirAt = (
  request: mutateOpsTypes.CreateDirRequest,
): Promise<envTypes.Result<void, envTypes.FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.asVoid(
          remoteRequest({
            connection,
            json: { path: resolved, recursive: request.recursive },
            op: "mkdir",
          }),
        ),
    }),
  );
};

const removeAt = (
  request: mutateOpsTypes.RemoveRequest,
): Promise<envTypes.Result<void, envTypes.FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.asVoid(
          remoteRequest({
            connection,
            json: { force: request.force, path: resolved, recursive: request.recursive },
            op: "rm",
          }),
        ),
    }),
  );
};

const mutateOps = {
  createDirAt,
  flushAt,
  removeAt,
  renameAt,
  truncateAt,
  writeAt,
};

export default mutateOps;
