import type aiTypes from "@msa/ai/index.types";

declare namespace fauxStreamTypes {
  interface FauxStreamFnState {
    callCount: number;
    contexts: aiTypes.TranscriptContext[];
  }
}

export type { fauxStreamTypes as default };
