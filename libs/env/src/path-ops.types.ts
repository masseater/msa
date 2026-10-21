import type chordTypes from "@msa/chord/index.types";
import type envTypes from "@msa/durable/env.types";

import type fileOpTypes from "./file-op.types.ts";

declare namespace pathOpsTypes {
  interface ListFilesRequest extends fileOpTypes.PathRequest {
    readonly options: envTypes.ListFilesOptions | undefined;
  }

  interface TempDirRequest {
    readonly target: fileOpTypes.RemoteTarget;
    readonly prefix: string | undefined;
    readonly context: chordTypes.Context;
  }

  interface TempFileRequest {
    readonly target: fileOpTypes.RemoteTarget;
    readonly prefix: string | undefined;
    readonly suffix: string | undefined;
    readonly context: chordTypes.Context;
  }
}

export type { pathOpsTypes as default };
