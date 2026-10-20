import type { FileKind } from "@msa/durable/env";

import type connectionTypes from "./connection.types.ts";

declare namespace remotePathTypes {
  type RemoteFileInfo = {
    name: string;
    kind: FileKind | "other";
    size: number;
    mtimeSec: number;
    mtimeNsec: number;
  };

  type RemoteDirEntry = {
    name: string;
    raw?: number[];
    info?: RemoteFileInfo;
    error?: connectionTypes.Json;
  };
}

export type { remotePathTypes as default };
