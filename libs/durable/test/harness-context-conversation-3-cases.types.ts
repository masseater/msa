import type durableTypes from "@msa/durable/index.types";

declare namespace harnessContextConversation3CasesTypes {
  type RandomTranscript = {
    seed: number;
    next: number;
    readonly written: durableTypes.EntryRecord[];
    readonly calls: string[];
    readonly seen: Map<string, number>;
  };
}

export type { harnessContextConversation3CasesTypes as default };
