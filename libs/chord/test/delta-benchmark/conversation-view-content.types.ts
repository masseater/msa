import type conversationViewTypes from "./conversation-view-types.types.ts";

declare namespace conversationViewContentTypes {
  interface EntrySpec {
    readonly id: number;
    readonly parent: number | null;
    readonly kind: conversationViewTypes.EntryKind;
  }
}

export type { conversationViewContentTypes as default };
