import type aiTypes from "@msa/ai/index.types";

import type typesModule from "./types.types.ts";

declare namespace contextRangeTypes {
  type ContextBounds = {
    readonly head: (typesModule.EntryRecord & { readonly head: typesModule.EntryId }) | undefined;
    readonly tail: typesModule.EntryId;
  };

  type ContextRange = {
    readonly bounds: ContextBounds;
    readonly entries: readonly typesModule.EntryRecord[];
    readonly view: typesModule.ContextView;
    readonly edited: ReadonlySet<typesModule.EntryId>;
    readonly settled: readonly aiTypes.Message[];
    readonly open: readonly aiTypes.Message[];
    readonly baseline: Baseline;
  };

  type Baseline = aiTypes.Message | null | undefined;
}

export type { contextRangeTypes as default };
