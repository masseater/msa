import type { TranscriptContext } from "@msa/ai";

declare namespace fauxStreamTypes {
  interface FauxStreamFnState {
    callCount: number;
    contexts: TranscriptContext[];
  }
}

export type { fauxStreamTypes as default };
