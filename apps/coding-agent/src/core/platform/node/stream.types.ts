import type { Readable as ReadableSource, Writable as WritableSource } from "node:stream";

declare namespace nodeStreamTypes {
  type Readable = ReadableSource;
  type Writable = WritableSource;
}

export type { nodeStreamTypes as default };
