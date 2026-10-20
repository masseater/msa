import type dirReader from "./dir-reader.ts";

declare namespace dirReaderTypes {
  type RemoteDirReader = (typeof dirReader.RemoteDirReader)["prototype"];
}

export type { dirReaderTypes as default };
