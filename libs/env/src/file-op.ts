import type { Context } from "@msa/chord";
import { type FileError, ok, type Result } from "@msa/durable/env";
import { Effect } from "effect";

import type { Connection, Json } from "./connection.ts";
import { abortResult, fileResult, recoverFileError } from "./errors.ts";
import { Handle } from "./handle.ts";
import { resolveRemotePath } from "./resolve-path.ts";

export interface RemoteTarget {
  readonly connection: Connection;
  readonly cwd: string;
}

export interface PathRequest {
  readonly target: RemoteTarget;
  readonly path: string;
  readonly context: Context;
}

export interface FileOp<T> extends PathRequest {
  readonly operation: (resolved: string) => Effect.Effect<T, FileError>;
  readonly check?: "before" | "both";
}

export interface ReaderOpen<R> extends PathRequest {
  readonly open: (resolved: string) => Effect.Effect<Handle>;
  readonly wrap: (handle: Handle) => R;
}

export type Opened = { handle: Handle; json: Json };

export interface RemoteRequest {
  readonly connection: Connection;
  readonly op: string;
  readonly json: Json;
  readonly payload?: Uint8Array;
}

export const run = <T>(effect: Effect.Effect<T>): Promise<T> => Effect.runPromise(effect);

export const resolveIn = (request: { target: RemoteTarget; path: string }): Effect.Effect<string> =>
  Effect.promise(() => request.target.connection.info()).pipe(
    Effect.map((info) => resolveRemotePath(request.path, info, request.target.cwd)),
  );

export const runFileOp = <T>(op: FileOp<T>): Effect.Effect<Result<T, FileError>> =>
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

export const remoteRequest = (request: RemoteRequest): Effect.Effect<Json> =>
  Effect.promise(() =>
    request.connection.request(
      request.op,
      request.json,
      request.payload === undefined ? {} : { payload: request.payload },
    ),
  ).pipe(Effect.map((reply) => reply.json));

export const openFile = (request: {
  connection: Connection;
  resolved: string;
  json: Json;
}): Effect.Effect<Opened> =>
  Effect.promise(() =>
    request.connection.request("open", { path: request.resolved, ...request.json }),
  ).pipe(
    Effect.map((reply) => ({
      handle: new Handle(request.connection, reply, request.resolved),
      json: reply.json,
    })),
  );

export const openDir = (request: {
  connection: Connection;
  resolved: string;
}): Effect.Effect<Handle> =>
  Effect.promise(() => request.connection.request("opendir", { path: request.resolved })).pipe(
    Effect.map((reply) => new Handle(request.connection, reply, request.resolved)),
  );

export const openReader = <R>(request: ReaderOpen<R>): Promise<Result<R, FileError>> =>
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
