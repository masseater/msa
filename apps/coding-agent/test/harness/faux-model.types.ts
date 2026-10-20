import type { JsonObject, StopReason, Usage } from "@msa/ai";

declare namespace fauxModelTypes {
  interface FauxResponse {
    text?: string;
    toolCalls?: Array<{ id?: string; name: string; args: JsonObject }>;
    thinking?: string;
    stopReason?: StopReason;
    error?: string;
    usage?: Partial<Usage>;
    delayMs?: number;
    model?: { provider?: string; id?: string };
  }

  type FauxResponseInput = FauxResponse | string;
}

export type { fauxModelTypes as default };
