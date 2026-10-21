import type nodeFsTypes from "../core/platform/node/fs.types.ts";

declare namespace outputFilesTypes {
  interface OutputFileStream {
    readonly path: string;
    readonly stream: nodeFsTypes.WriteStream;
  }
}

export type { outputFilesTypes as default };
