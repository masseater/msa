import type chordTypes from "@msa/chord/index.types";
import json from "@msa/chord/json";
import { Effect, Function } from "effect";

import documents from "../documents.ts";
import entries from "../entries.ts";
import type inboxTypes from "./inbox.types.ts";
import type typesModule from "./types.types.ts";

const { copyJson } = json;

const { defineDoc } = documents;
const { UserEntry } = entries;

const InboxDoc = defineDoc<inboxTypes.InboxState>({
  checkpointWhen: (value) => value.items.length === 0,
  fork: "initial",
  history: "latest",
  initial: () => ({ items: [] }),
  kind: "msa.inbox",
  scope: "conversation",
  version: 1,
});

const prepareBoundary: typesModule.Dual3<
  typesModule.Tx,
  typesModule.ConversationId,
  inboxTypes.QueueModes,
  Effect.Effect<inboxTypes.Boundary>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    modes: inboxTypes.QueueModes,
  ) {
    const marker = yield* Effect.promise(() => tx.latestHeadMarker(conversationId));
    const inbox = yield* Effect.promise(() => tx.doc(InboxDoc, conversationId));
    return {
      conversationId,
      followUpMode: modes.followUpMode,
      head: marker?.head,
      inbox,
      steeringMode: modes.steeringMode,
    };
  }),
);

const pickIndexes = (
  items: readonly chordTypes.Draft<inboxTypes.InboxItem>[],
  mode: "steer" | "followUp",
  queueMode: typesModule.QueueMode,
): number[] => {
  const indexes = items.flatMap((item, index) => (item.mode === mode ? [index] : []));
  return queueMode === "all" ? indexes : indexes.slice(0, 1);
};

const applyWrite = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  boundary: inboxTypes.Boundary,
  item: chordTypes.Draft<Extract<inboxTypes.InboxItem, { mode: "write" }>>,
) {
  const draft = item.entry as chordTypes.Draft<typesModule.EntryDraft>;
  if (isStale(boundary, draft)) {
    tx.settleSubmission(item.id, { reason: "stale", status: "unanswered" });
    return;
  }
  const entry = yield* Effect.promise(() => tx.appendEntry(boundary.conversationId, draft));
  if (draft.head !== undefined) boundary.head = draft.head === "self" ? entry.id : draft.head;
  tx.placeSubmission(item.id, entry.id);
});

const applyUser = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  conversationId: typesModule.ConversationId,
  item: chordTypes.Draft<Extract<inboxTypes.InboxItem, { mode: "steer" | "followUp" }>>,
  now: number,
) {
  const entry = yield* appendInput(
    tx,
    conversationId,
    item.content as typesModule.UserInput,
    item.entry as typesModule.InputEntry,
    now,
  );
  tx.placeSubmission(item.id, entry.id);
  return item.id;
});

const applyBoundary: typesModule.Dual4<
  typesModule.Tx,
  inboxTypes.Boundary,
  "postTools" | "final",
  number,
  Effect.Effect<inboxTypes.BoundaryResult>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    boundary: inboxTypes.Boundary,
    at: "postTools" | "final",
    now: number,
  ) {
    const { conversationId, inbox } = boundary;
    const items = inbox.items;
    const reset = hasQueuedReset(items);
    const final = at === "final" || reset;
    const writes = items.flatMap((item, index) => (item.mode === "write" ? [index] : []));
    const users = [
      ...pickIndexes(items, "steer", boundary.steeringMode),
      ...(final ? pickIndexes(items, "followUp", boundary.followUpMode) : []),
    ];
    users.sort((a, b) => a - b);
    yield* Effect.forEach(
      writes,
      (index) =>
        applyWrite(
          tx,
          boundary,
          items[index] as chordTypes.Draft<Extract<inboxTypes.InboxItem, { mode: "write" }>>,
        ),
      { discard: true },
    );
    const placed = yield* Effect.forEach(users, (index) =>
      applyUser(
        tx,
        conversationId,
        items[index] as chordTypes.Draft<
          Extract<inboxTypes.InboxItem, { mode: "steer" | "followUp" }>
        >,
        now,
      ),
    );
    const removed = [...writes, ...users].sort((a, b) => b - a);
    for (const index of removed) items.splice(index, 1);
    return { reset, users: placed };
  }),
);

const appendInput: typesModule.Dual5<
  typesModule.Tx,
  typesModule.ConversationId,
  typesModule.UserInput,
  typesModule.InputEntry | undefined,
  number,
  Effect.Effect<typesModule.EntryRecord>
> = Function.dual(
  5,
  (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    content: typesModule.UserInput,
    entry: typesModule.InputEntry | undefined,
    now: number,
  ): Effect.Effect<typesModule.EntryRecord> => {
    const message = { content, role: "user", timestamp: now } as const;
    return Effect.promise(() =>
      entry === undefined
        ? tx.appendEntry(UserEntry, conversationId, { model: [message] })
        : tx.appendEntry(conversationId, { ...pickInputEntry(entry), model: [message] }),
    );
  },
);

function pickInputEntry({
  kind,
  data,
}: typesModule.InputEntry): chordTypes.JsonRepresentation<typesModule.InputEntry> {
  const picked = data === undefined ? { kind } : { data, kind };
  return copyJson(picked, {
    omitUndefinedProperties: true,
  }) as chordTypes.JsonRepresentation<typesModule.InputEntry>;
}

function isDisplayOnly(entry: typesModule.EntryDraft): boolean {
  return entry.model === undefined && entry.head === undefined && entry.edits === undefined;
}

function hasQueuedReset(items: readonly inboxTypes.InboxItem[]): boolean {
  return items.some((item) => item.mode === "write" && item.entry["head"] === "self");
}

const isStale: typesModule.Dual2<inboxTypes.Boundary, typesModule.EntryDraft, boolean> =
  Function.dual(
    2,
    (boundary: inboxTypes.Boundary, entry: typesModule.EntryDraft): boolean =>
      typeof entry.head === "number" && boundary.head !== undefined && entry.head < boundary.head,
  );

const removeInboxItem: typesModule.Dual3<
  typesModule.Tx,
  typesModule.ConversationId,
  typesModule.SubmissionId,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    id: typesModule.SubmissionId,
  ) {
    const items = (yield* Effect.promise(() => tx.doc(InboxDoc, conversationId))).items;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) items.splice(index, 1);
  }),
);

const withdrawQueuedInputs: typesModule.Dual2<
  typesModule.Tx,
  typesModule.ConversationId,
  Effect.Effect<void>
> = Function.dual(
  2,
  Effect.fnUntraced(function* (tx: typesModule.Tx, conversationId: typesModule.ConversationId) {
    const items = (yield* Effect.promise(() => tx.doc(InboxDoc, conversationId))).items;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index]!;
      if (item.mode === "write") continue;
      tx.settleSubmission(item.id, { reason: "aborted", status: "unanswered" });
      items.splice(index, 1);
    }
  }),
);

const inboxModule = {
  InboxDoc,
  appendInput,
  applyBoundary,
  hasQueuedReset,
  isDisplayOnly,
  isStale,
  pickInputEntry,
  prepareBoundary,
  removeInboxItem,
  withdrawQueuedInputs,
};

export default inboxModule;
