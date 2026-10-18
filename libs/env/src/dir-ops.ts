import { FileError, type FileInfo, type Result } from "@msa/durable/env";
import { Effect } from "effect";

import { type Connection, RemoteError } from "./connection.ts";
import { toFileError } from "./errors.ts";
import { openDir, type PathRequest, remoteRequest, run, runFileOp } from "./file-op.ts";
import { posixPath } from "./platform.ts";
import { type RemoteDirEntry, remoteFileInfo, remotePath, toInfo } from "./remote-path.ts";

export const fileInfoAt = (request: PathRequest): Promise<Result<FileInfo, FileError>> => {
  const { connection } = request.target;
  return run(
    runFileOp({
      ...request,
      operation: (resolved) =>
        Effect.all([
          remoteRequest({ connection, op: "lstat", json: { path: resolved } }),
          remotePath(connection),
        ]).pipe(Effect.map(([json, paths]) => toInfo(resolved, remoteFileInfo(json), paths))),
    }).pipe(Effect.map((result) => (result.ok ? result.value : result))),
  );
};

const readAllEntries = (request: {
  connection: Connection;
  resolved: string;
}): Effect.Effect<RemoteDirEntry[]> =>
  openDir(request).pipe(
    Effect.flatMap((handle) =>
      Effect.gen(function* () {
        const entries: RemoteDirEntry[] = [];
        for (let done = false; !done;) {
          const { json } = yield* Effect.promise(() => handle.request("readdir", { max: 1000 }));
          entries.push(...(json["entries"] as RemoteDirEntry[]));
          done = json["done"] === true;
        }
        return entries;
      }).pipe(Effect.ensuring(Effect.promise(() => handle.close()))),
    ),
  );

const sortRaw = (entries: RemoteDirEntry[]): void => {
  const key = (entry: RemoteDirEntry): Buffer =>
    Buffer.from(entry.raw ?? Buffer.from(entry.name, "utf8"));
  entries.sort((a, b) => Buffer.compare(key(a), key(b)));
};

export const listDirAt = (request: PathRequest): Promise<Result<FileInfo[], FileError>> => {
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
          const infos: FileInfo[] = [];
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
