import type fileOpTypes from "./file-op.types.ts";

declare namespace readOpsTypes {
  interface FileReadRequest extends fileOpTypes.PathRequest {
    readonly encoding: boolean;
  }

  interface BinaryReaderRequest extends fileOpTypes.PathRequest {
    readonly noFollow: boolean;
  }

  interface TextLinesRequest extends fileOpTypes.PathRequest {
    readonly maxLines: number | undefined;
  }
}

export type { readOpsTypes as default };
