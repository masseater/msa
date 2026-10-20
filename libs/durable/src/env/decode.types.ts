import type StreamDecoderClass from "./stream-decoder.ts";

declare namespace decodeTypes {
  type StreamDecoder = StreamDecoderClass;
}

export type { decodeTypes as default };
