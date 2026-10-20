import type fileErrorTypes from "../file-error.types.ts";
import type lineScanTypes from "../line-scan.types.ts";
import type NodeBinaryReaderClass from "./node-binary-reader.ts";
import type nodePathsTypes from "./node-paths.types.ts";

declare namespace nodeBinaryReaderTypes {
  interface ReadableFile {
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ): Promise<{ bytesRead: number }>;
    stat(): Promise<nodePathsTypes.StatsLike>;
    close(): Promise<void>;
  }

  type NodeBinaryReader = NodeBinaryReaderClass;

  type FileError = fileErrorTypes.FileError;

  type LineScanner = lineScanTypes.LineScanner;
}

export type { nodeBinaryReaderTypes as default };
