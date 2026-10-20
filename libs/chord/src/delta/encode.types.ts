import type opsTypes from "./ops.types.ts";

declare namespace encodeTypes {
  interface Encoder {
    encode(ops: readonly opsTypes.Op[]): opsTypes.WireOp[];
  }
}

export type { encodeTypes as default };
