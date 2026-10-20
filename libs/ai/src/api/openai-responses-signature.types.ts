import type typesModule from "../types.types.ts";

declare namespace openaiResponsesSignatureTypes {
  type Phase = typesModule.TextSignatureV1["phase"];

  interface ParsedTextSignature {
    readonly id: string;
    readonly phase?: Phase;
  }
}

export type { openaiResponsesSignatureTypes as default };
