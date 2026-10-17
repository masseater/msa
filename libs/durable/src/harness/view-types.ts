import type { Context } from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type { CommitPublication, ConversationRecord, EntryRecord, JsonObject } from "./types.ts";

export type ConversationView = {
  readonly conversation: ConversationRecord;
  readonly entries: readonly EntryRecord[];
  readonly docs: Readonly<Record<string, JsonObject>>;
};

export type ViewObserver = {
  advance?(value: ConversationView, ops: readonly Op[], context: Context): void;
  publication?(
    before: ConversationView,
    after: ConversationView,
    ops: readonly Op[],
    publication: CommitPublication,
    context: Context,
  ): void;
  closeSession(failure: { readonly error: unknown } | undefined): void;
};
