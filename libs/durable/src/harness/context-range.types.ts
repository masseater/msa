import type { Message } from "@msa/ai";

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
    readonly settled: readonly Message[];
    readonly open: readonly Message[];
    readonly baseline: Baseline;
  };

  type Baseline = Message | null | undefined;
}

export type { contextRangeTypes as default };
