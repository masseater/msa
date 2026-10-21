import type fileOpTypes from "./file-op.types.ts";

declare namespace mutateOpsTypes {
  interface WriteRequest extends fileOpTypes.PathRequest {
    readonly content: string | Uint8Array;
    readonly append: boolean;
  }

  interface TruncateRequest extends fileOpTypes.PathRequest {
    readonly size: number;
  }

  interface RenameRequest extends fileOpTypes.PathRequest {
    readonly destination: string;
  }

  interface CreateDirRequest extends fileOpTypes.PathRequest {
    readonly recursive: boolean;
  }

  interface RemoveRequest extends fileOpTypes.PathRequest {
    readonly recursive: boolean;
    readonly force: boolean;
  }
}

export type { mutateOpsTypes as default };
