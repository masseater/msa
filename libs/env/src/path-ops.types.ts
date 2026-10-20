import type { Context } from "@msa/chord";
import type { ListFilesOptions } from "@msa/durable/env";

import type fileOpTypes from "./file-op.types.ts";

declare namespace pathOpsTypes {
  interface ListFilesRequest extends fileOpTypes.PathRequest {
    readonly options: ListFilesOptions | undefined;
  }

  interface TempDirRequest {
    readonly target: fileOpTypes.RemoteTarget;
    readonly prefix: string | undefined;
    readonly context: Context;
  }

  interface TempFileRequest {
    readonly target: fileOpTypes.RemoteTarget;
    readonly prefix: string | undefined;
    readonly suffix: string | undefined;
    readonly context: Context;
  }
}

export type { pathOpsTypes as default };
