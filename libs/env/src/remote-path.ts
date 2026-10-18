import { err, FileError, type FileInfo, type FileKind, ok, type Result } from "@msa/durable/env";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { Connection, Json } from "./connection.ts";
import { type PathOps, posixPath, win32Path } from "./platform.ts";
import { nodePlatform } from "./remote-info.ts";

export type RemoteFileInfo = {
  name: string;
  kind: FileKind | "other";
  size: number;
  mtimeSec: number;
  mtimeNsec: number;
};

export type RemoteDirEntry = { name: string; raw?: number[]; info?: RemoteFileInfo; error?: Json };

export const remotePath = (connection: Connection): Effect.Effect<PathOps> =>
  Effect.promise(() => connection.info()).pipe(
    Effect.map((info) => (nodePlatform(info).platform === "win32" ? win32Path : posixPath)),
  );

export const toInfo: {
  (remote: RemoteFileInfo, paths: PathOps): (path: string) => Result<FileInfo, FileError>;
  (path: string, remote: RemoteFileInfo, paths: PathOps): Result<FileInfo, FileError>;
} = dual(3, (path: string, remote: RemoteFileInfo, paths: PathOps): Result<FileInfo, FileError> => {
  if (remote.kind === "other") {
    return err(new FileError("invalid", "Unsupported file type", path));
  }
  return ok({
    name: paths.basename(path),
    path,
    kind: remote.kind,
    size: remote.size,
    mtimeMs: remote.mtimeSec * 1000 + remote.mtimeNsec / 1e6,
  });
});

export const remoteFileInfo = (json: Json): RemoteFileInfo => json as RemoteFileInfo;
