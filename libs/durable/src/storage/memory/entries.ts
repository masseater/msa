import { Function } from "effect";

import { StorageRequestError } from "../../errors.ts";
import type { ConversationId, EntryId, EntryRecord } from "../../types.ts";
import { clone, lowerBound, type State, upperBound } from "./state.ts";

const assertConversation = (state: State, conversationId: ConversationId): void => {
  if (!state.conversations.has(conversationId)) {
    throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
  }
};

type Segment = { readonly conversationId: ConversationId; readonly upper: number };

const segments = (
  state: State,
  conversationId: ConversationId,
  minEntryId: number,
  maxEntryId: number,
): Segment[] => {
  assertConversation(state, conversationId);
  const found: Segment[] = [];
  let currentId = conversationId;
  let upperEntryId = maxEntryId;
  while (true) {
    found.push({ conversationId: currentId, upper: upperEntryId });
    const conversation = state.conversations.get(currentId)!;
    if (conversation.parent === undefined) break;
    upperEntryId = Math.min(upperEntryId, conversation.parent.at);
    if (upperEntryId < minEntryId) break;
    currentId = conversation.parent.conversationId;
  }
  return found;
};

type VisibleEntries = {
  (
    conversationId: ConversationId,
    minEntryId?: number,
    maxEntryId?: number,
  ): (state: State) => Generator<EntryRecord>;
  (
    state: State,
    conversationId: ConversationId,
    minEntryId?: number,
    maxEntryId?: number,
  ): Generator<EntryRecord>;
};

const isState = (args: IArguments): boolean => typeof args[0] === "object";

export const visibleEntries: VisibleEntries = Function.dual(
  isState,
  function* (
    state: State,
    conversationId: ConversationId,
    minEntryId: number = Number.NEGATIVE_INFINITY,
    maxEntryId: number = Number.POSITIVE_INFINITY,
  ): Generator<EntryRecord> {
    assertConversation(state, conversationId);
    for (const segment of segments(state, conversationId, minEntryId, maxEntryId)) {
      const ids = state.entryIds.get(segment.conversationId) ?? [];
      for (let index = upperBound(ids, segment.upper) - 1; index >= 0; index--) {
        const id = ids[index];
        if (id === undefined || id < minEntryId) break;
        yield state.entries.get(id)!;
      }
    }
  },
);

export const visibleEntriesAscending: VisibleEntries = Function.dual(
  isState,
  function* (
    state: State,
    conversationId: ConversationId,
    minEntryId: number = Number.NEGATIVE_INFINITY,
    maxEntryId: number = Number.POSITIVE_INFINITY,
  ): Generator<EntryRecord> {
    for (const segment of segments(state, conversationId, minEntryId, maxEntryId).reverse()) {
      const ids = state.entryIds.get(segment.conversationId) ?? [];
      for (let index = lowerBound(ids, minEntryId); index < ids.length; index++) {
        const id = ids[index]!;
        if (id > segment.upper) break;
        yield state.entries.get(id)!;
      }
    }
  },
);

export const latestHeadMarker: {
  (
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
  ): (state: State) => (EntryRecord & { readonly head: EntryId }) | undefined;
  (
    state: State,
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
  ): (EntryRecord & { readonly head: EntryId }) | undefined;
} = Function.dual(
  3,
  (
    state: State,
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
  ): (EntryRecord & { readonly head: EntryId }) | undefined => {
    assertConversation(state, conversationId);
    let currentId = conversationId;
    let upperEntryId = atOrBeforeEntryId ?? Number.POSITIVE_INFINITY;
    while (true) {
      const ids = state.headEntryIds.get(currentId) ?? [];
      const id = ids[upperBound(ids, upperEntryId) - 1];
      if (id !== undefined) {
        const entry = state.entries.get(id)!;
        return clone({ ...entry, head: entry.head! });
      }
      const conversation = state.conversations.get(currentId)!;
      if (conversation.parent === undefined) return undefined;
      upperEntryId = Math.min(upperEntryId, conversation.parent.at);
      currentId = conversation.parent.conversationId;
    }
  },
);
