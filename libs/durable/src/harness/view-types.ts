import type deltaTypes from "@msa/chord/delta.types";
import type chordTypes from "@msa/chord/index.types";

import type typesModule from "./types.types.ts";

declare namespace viewTypesModule {
  type ConversationView = {
    readonly conversation: typesModule.ConversationRecord;
    readonly entries: readonly typesModule.EntryRecord[];
    readonly docs: Readonly<Record<string, typesModule.JsonObject>>;
  };

  type ViewObserver = {
    advance?(
      value: ConversationView,
      ops: readonly deltaTypes.Op[],
      context: chordTypes.Context,
    ): void;
    publication?(
      before: ConversationView,
      after: ConversationView,
      ops: readonly deltaTypes.Op[],
      publication: typesModule.CommitPublication,
      context: chordTypes.Context,
    ): void;
    closeSession(failure: { readonly error: unknown } | undefined): void;
  };
}

export type { viewTypesModule as default };
