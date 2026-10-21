import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";

import connectionModule from "./connection.ts";
import type dirOpsTypes from "./dir-ops.types.ts";
import errors from "./errors.ts";
import fileOp from "./file-op.ts";
import platform from "./platform.ts";
import remotePathModule from "./remote-path.ts";
import type remotePathTypes from "./remote-path.types.ts";

const { FileError } = env;

const { openDir, remoteRequest, run, runFileOp } = fileOp;
const { remoteFileInfo, remotePath, toInfo } = remotePathModule;
const { posixPath } = platform;
const { toFileError } = errors;
const { RemoteError } = connectionModule;

const fileInfoAt = (
  request: dirOpsTypes.PathRequest,
): Promise<envTypes.Result<envTypes.FileInfo, envTypes.FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.all([
          remoteRequest({ connection, json: { path: resolved }, op: "lstat" }),
          remotePath(connection),
        ]).pipe(Effect.map(([json, paths]) => toInfo(resolved, remoteFileInfo(json), paths))),
    }).pipe(Effect.map((result) => (result.ok ? result.value : result))),
  );
};

const readAllEntries = (request: {
  connection: dirOpsTypes.Connection;
  resolved: string;
}): Effect.Effect<remotePathTypes.RemoteDirEntry[]> =>
  openDir(request).pipe(
    Effect.flatMap((handle) =>
      Effect.gen(function* () {
        const entries: remotePathTypes.RemoteDirEntry[] = [];
        for (let done = false; !done;) {
          const { json } = yield* Effect.promise(() => handle.request("readdir", { max: 1000 }));
          entries.push(...(json["entries"] as remotePathTypes.RemoteDirEntry[]));
          done = json["done"] === true;
        }
        return entries;
      }).pipe(Effect.ensuring(Effect.promise(() => handle.close()))),
    ),
  );

const sortRaw = (entries: remotePathTypes.RemoteDirEntry[]): void => {
  const key = (entry: remotePathTypes.RemoteDirEntry): Buffer =>
    Buffer.from(entry.raw ?? Buffer.from(entry.name, "utf8"));
  entries.sort((a, b) => Buffer.compare(key(a), key(b)));
};

const listDirAt = (
  request: dirOpsTypes.PathRequest,
): Promise<envTypes.Result<envTypes.FileInfo[], envTypes.FileError>> => {
  const { connection } = request.target;
  const signal = request.context.abortSignal;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.gen(function* () {
          const entries = yield* readAllEntries({ connection, resolved });
          const paths = yield* remotePath(connection);
          if (paths === posixPath) sortRaw(entries);
          const infos: envTypes.FileInfo[] = [];
          for (const entry of entries) {
            if (signal?.aborted === true) {
              return yield* new FileError("aborted", "aborted", resolved);
            }
            const entryPath = paths.resolve(resolved, entry.name);
            if (entry.error !== undefined) {
              return yield* toFileError(new RemoteError(entry.error), entryPath);
            }
            const info = toInfo(entryPath, entry.info!, paths);
            if (info.ok) infos.push(info.value);
          }
          return infos;
        }),
    }),
  );
};

const dirOps = {
  fileInfoAt,
  listDirAt,
};

export default dirOps;
