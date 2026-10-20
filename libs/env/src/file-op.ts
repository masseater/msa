import { type FileError, type Result, ok } from "@msa/durable/env";
import { Effect } from "effect";

import type connectionTypes from "./connection.types.ts";
import errors from "./errors.ts";
import type fileOpTypes from "./file-op.types.ts";
import handleModule from "./handle.ts";
import type handleTypes from "./handle.types.ts";
import resolvePath from "./resolve-path.ts";

const { resolveRemotePath } = resolvePath;
const { abortResult, fileResult, recoverFileError } = errors;
const { Handle } = handleModule;

const run = <T>(effect: Effect.Effect<T>): Promise<T> => Effect.runPromise(effect);

const resolveIn = (request: {
  target: fileOpTypes.RemoteTarget;
  path: string;
}): Effect.Effect<string> =>
  Effect.promise(() => request.target.connection.info()).pipe(
    Effect.map((info) => resolveRemotePath(request.path, info, request.target.cwd)),
  );

const runFileOp = <T>(op: fileOpTypes.FileOp<T>): Effect.Effect<Result<T, FileError>> =>
  Effect.gen(function* () {
    const resolved = yield* fileResult(resolveIn(op), op.path);
    if (!resolved.ok) return resolved;
    const target = resolved.value;
    const aborted = abortResult<T>(op.context.abortSignal, target);
    if (aborted !== undefined) return aborted;
    return yield* recoverFileError(
      op.operation(target).pipe(
        Effect.map((value) => {
          const after =
            op.check === "both" ? abortResult<T>(op.context.abortSignal, target) : undefined;
          return after ?? ok<T, FileError>(value);
        }),
      ),
      target,
    );
  });

const remoteRequest = (request: fileOpTypes.RemoteRequest): Effect.Effect<connectionTypes.Json> =>
  Effect.promise(() =>
    request.connection.request(
      request.op,
      request.json,
      request.payload === undefined ? {} : { payload: request.payload },
    ),
  ).pipe(Effect.map((reply) => reply.json));

const openFile = (request: {
  connection: connectionTypes.Connection;
  resolved: string;
  json: connectionTypes.Json;
}): Effect.Effect<fileOpTypes.Opened> =>
  Effect.promise(() =>
    request.connection.request("open", { path: request.resolved, ...request.json }),
  ).pipe(
    Effect.map((reply) => ({
      handle: new Handle(request.connection, reply, request.resolved),
      json: reply.json,
    })),
  );

const openDir = (request: {
  connection: connectionTypes.Connection;
  resolved: string;
}): Effect.Effect<handleTypes.Handle> =>
  Effect.promise(() => request.connection.request("opendir", { path: request.resolved })).pipe(
    Effect.map((reply) => new Handle(request.connection, reply, request.resolved)),
  );

const openReader = <R>(request: fileOpTypes.ReaderOpen<R>): Promise<Result<R, FileError>> =>
  run(
    Effect.gen(function* () {
      const opened = yield* runFileOp({ ...request, operation: request.open });
      if (!opened.ok) return opened;
      const aborted = abortResult<R>(request.context.abortSignal, opened.value.path);
      if (aborted !== undefined) {
        yield* Effect.promise(() => opened.value.close());
        return aborted;
      }
      return ok<R, FileError>(request.wrap(opened.value));
    }),
  );

const fileOp = {
  openDir,
  openFile,
  openReader,
  remoteRequest,
  resolveIn,
  run,
  runFileOp,
};

export default fileOp;
