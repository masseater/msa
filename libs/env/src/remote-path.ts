import env from "@msa/durable/env";
import type envTypes from "@msa/durable/env.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type connectionTypes from "./connection.types.ts";
import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";
import remoteInfo from "./remote-info.ts";
import type remotePathTypes from "./remote-path.types.ts";

const { FileError, err, ok } = env;

const { nodePlatform } = remoteInfo;
const { posixPath, win32Path } = platformModule;

const remotePath = (connection: connectionTypes.Connection): Effect.Effect<platformTypes.PathOps> =>
  Effect.promise(() => connection.info()).pipe(
    Effect.map((info) => (nodePlatform(info).platform === "win32" ? win32Path : posixPath)),
  );

const toInfo: {
  (
    remote: remotePathTypes.RemoteFileInfo,
    paths: platformTypes.PathOps,
  ): (path: string) => envTypes.Result<envTypes.FileInfo, envTypes.FileError>;
  (
    path: string,
    remote: remotePathTypes.RemoteFileInfo,
    paths: platformTypes.PathOps,
  ): envTypes.Result<envTypes.FileInfo, envTypes.FileError>;
} = dual(
  3,
  (
    path: string,
    remote: remotePathTypes.RemoteFileInfo,
    paths: platformTypes.PathOps,
  ): envTypes.Result<envTypes.FileInfo, envTypes.FileError> => {
    if (remote.kind === "other") {
      return err(new FileError("invalid", "Unsupported file type", path));
    }
    return ok({
      kind: remote.kind,
      mtimeMs: remote.mtimeSec * 1000 + remote.mtimeNsec / 1e6,
      name: paths.basename(path),
      path,
      size: remote.size,
    });
  },
);

const remoteFileInfo = (json: connectionTypes.Json): remotePathTypes.RemoteFileInfo =>
  json as remotePathTypes.RemoteFileInfo;

const remotePathModule = {
  remoteFileInfo,
  remotePath,
  toInfo,
};

export default remotePathModule;
