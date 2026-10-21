import type chordTypes from "@msa/chord/index.types";

declare namespace nodeFilesTypes {
  interface FileRequest {
    readonly path: string;
    readonly context: chordTypes.Context;
  }

  interface WriteRequest extends FileRequest {
    readonly content: string | Uint8Array;
  }

  interface TruncateRequest extends FileRequest {
    readonly size: number;
  }

  interface RenameRequest extends FileRequest {
    readonly source: string;
  }

  interface CreateDirRequest extends FileRequest {
    readonly recursive: boolean;
  }

  interface RemoveRequest extends FileRequest {
    readonly recursive: boolean;
    readonly force: boolean;
  }

  interface TempDirRequest {
    readonly prefix: string;
    readonly context: chordTypes.Context;
  }

  interface TempFileRequest {
    readonly directory: string;
    readonly prefix: string;
    readonly suffix: string;
  }
}

export type { nodeFilesTypes as default };
