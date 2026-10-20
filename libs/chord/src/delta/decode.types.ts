import type opsTypes from "./ops.types.ts";

declare namespace decodeTypes {
  interface Decoder {
    decode(wire: readonly unknown[]): opsTypes.Op[];
  }
}

export type { decodeTypes as default };
