import type { WriteStream } from "node:fs";

import type nodeFilesTypes from "./node-files.types.ts";

declare namespace nodeHandlesTypes {
  interface BinaryOpenRequest extends nodeFilesTypes.FileRequest {
    readonly noFollow: boolean;
  }

  type AppendStream = WriteStream;

  interface AppendStreamRequest {
    readonly path: string;
    readonly highWaterMark: number;
  }
}

export type { nodeHandlesTypes as default };
