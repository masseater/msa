import type textLineReader from "./text-line-reader.ts";

declare namespace textLineReaderTypes {
  type RemoteTextLineReader = (typeof textLineReader.RemoteTextLineReader)["prototype"];
}

export type { textLineReaderTypes as default };
