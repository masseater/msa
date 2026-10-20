import type fileErrorTypes from "../file-error.types.ts";
import type NodeDirReaderClass from "./node-dir-reader.ts";
import type nodePathsTypes from "./node-paths.types.ts";

declare namespace nodeDirReaderTypes {
  interface ReadableDir {
    read(): Promise<{ readonly name: string } | null>;
    close(): Promise<void>;
  }

  type LinkStat = (path: string) => Promise<nodePathsTypes.StatsLike>;

  type NodeDirReader = NodeDirReaderClass;

  type FileError = fileErrorTypes.FileError;
}

export type { nodeDirReaderTypes as default };
