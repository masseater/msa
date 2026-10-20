import { Function } from "effect";

import errors from "../../errors.ts";
import type typesModule from "../../types.types.ts";
import stateModule from "./state.ts";
import type stateTypes from "./state.types.ts";

const { StorageRequestError } = errors;
const { clone, lowerBound, upperBound } = stateModule;

const assertConversation = (
  state: stateTypes.State,
  conversationId: typesModule.ConversationId,
): void => {
  if (!state.conversations.has(conversationId)) {
    throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
  }
};

type Segment = { readonly conversationId: typesModule.ConversationId; readonly upper: number };

const segments = (
  state: stateTypes.State,
  conversationId: typesModule.ConversationId,
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
    conversationId: typesModule.ConversationId,
    minEntryId?: number,
    maxEntryId?: number,
  ): (state: stateTypes.State) => Generator<typesModule.EntryRecord>;
  (
    state: stateTypes.State,
    conversationId: typesModule.ConversationId,
    minEntryId?: number,
    maxEntryId?: number,
  ): Generator<typesModule.EntryRecord>;
};

const isState = (args: IArguments): boolean => typeof args[0] === "object";

const visibleEntries: VisibleEntries = Function.dual(
  isState,
  function* (
    state: stateTypes.State,
    conversationId: typesModule.ConversationId,
    minEntryId: number = Number.NEGATIVE_INFINITY,
    maxEntryId: number = Number.POSITIVE_INFINITY,
  ): Generator<typesModule.EntryRecord> {
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

const visibleEntriesAscending: VisibleEntries = Function.dual(
  isState,
  function* (
    state: stateTypes.State,
    conversationId: typesModule.ConversationId,
    minEntryId: number = Number.NEGATIVE_INFINITY,
    maxEntryId: number = Number.POSITIVE_INFINITY,
  ): Generator<typesModule.EntryRecord> {
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

const latestHeadMarker: {
  (
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
  ): (
    state: stateTypes.State,
  ) => (typesModule.EntryRecord & { readonly head: typesModule.EntryId }) | undefined;
  (
    state: stateTypes.State,
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
  ): (typesModule.EntryRecord & { readonly head: typesModule.EntryId }) | undefined;
} = Function.dual(
  3,
  (
    state: stateTypes.State,
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
  ): (typesModule.EntryRecord & { readonly head: typesModule.EntryId }) | undefined => {
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

const entriesModule = {
  latestHeadMarker,
  visibleEntries,
  visibleEntriesAscending,
};

export default entriesModule;
