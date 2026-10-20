import type binaryReader from "./binary-reader.ts";

declare namespace binaryReaderTypes {
  type RemoteBinaryReader = (typeof binaryReader.RemoteBinaryReader)["prototype"];
}

export type { binaryReaderTypes as default };
