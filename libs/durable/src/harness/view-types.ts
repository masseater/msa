import type { Context } from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type typesModule from "./types.types.ts";

declare namespace viewTypesModule {
  type ConversationView = {
    readonly conversation: typesModule.ConversationRecord;
    readonly entries: readonly typesModule.EntryRecord[];
    readonly docs: Readonly<Record<string, typesModule.JsonObject>>;
  };

  type ViewObserver = {
    advance?(value: ConversationView, ops: readonly Op[], context: Context): void;
    publication?(
      before: ConversationView,
      after: ConversationView,
      ops: readonly Op[],
      publication: typesModule.CommitPublication,
      context: Context,
    ): void;
    closeSession(failure: { readonly error: unknown } | undefined): void;
  };
}

export type { viewTypesModule as default };
