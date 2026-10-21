import type aiTypes from "@msa/ai/index.types";

declare namespace fauxModelTypes {
  interface FauxResponse {
    text?: string;
    toolCalls?: Array<{ id?: string; name: string; args: aiTypes.JsonObject }>;
    thinking?: string;
    stopReason?: aiTypes.StopReason;
    error?: string;
    usage?: Partial<aiTypes.Usage>;
    delayMs?: number;
    model?: { provider?: string; id?: string };
  }

  type FauxResponseInput = FauxResponse | string;
}

export type { fauxModelTypes as default };
