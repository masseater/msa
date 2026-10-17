import { copyJson, type Draft, type JsonRepresentation } from "@msa/chord";
import { Effect, Function } from "effect";

import { defineDoc } from "../documents.ts";
import { UserEntry } from "../entries.ts";
import type {
  ConversationId,
  Dual2,
  Dual3,
  Dual4,
  Dual5,
  EntryDraft,
  EntryId,
  EntryRecord,
  InputEntry,
  JsonObject,
  QueueMode,
  Settings,
  SubmissionId,
  Tx,
  UserInput,
} from "./types.ts";

export type InboxItem =
  | {
      id: SubmissionId;
      mode: "steer" | "followUp";
      content: JsonRepresentation<UserInput>;
      entry?: JsonRepresentation<InputEntry>;
    }
  | { id: SubmissionId; mode: "write"; entry: JsonObject };

export type InboxState = { items: InboxItem[] };

export const InboxDoc = defineDoc<InboxState>({
  kind: "msa.inbox",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: [] }),
  checkpointWhen: (value) => value.items.length === 0,
});

export type QueueModes = Pick<Settings, "steeringMode" | "followUpMode">;

export type Boundary = {
  readonly conversationId: ConversationId;
  readonly inbox: Draft<InboxState>;
  readonly steeringMode: QueueMode;
  readonly followUpMode: QueueMode;
  head: EntryId | undefined;
};

export type BoundaryResult = { readonly users: SubmissionId[]; readonly reset: boolean };

export const prepareBoundary: Dual3<
  Tx,
  ConversationId,
  QueueModes,
  Effect.Effect<Boundary>
> = Function.dual(
  3,
  Effect.fn("prepareBoundary")(function* (
    tx: Tx,
    conversationId: ConversationId,
    modes: QueueModes,
  ) {
    const marker = yield* Effect.promise(() => tx.latestHeadMarker(conversationId));
    const inbox = yield* Effect.promise(() => tx.doc(InboxDoc, conversationId));
    return {
      conversationId,
      inbox,
      steeringMode: modes.steeringMode,
      followUpMode: modes.followUpMode,
      head: marker?.head,
    };
  }),
);

const pickIndexes = (
  items: readonly Draft<InboxItem>[],
  mode: "steer" | "followUp",
  queueMode: QueueMode,
): number[] => {
  const indexes = items.flatMap((item, index) => (item.mode === mode ? [index] : []));
  return queueMode === "all" ? indexes : indexes.slice(0, 1);
};

const applyWrite = Effect.fn("applyWrite")(function* (
  tx: Tx,
  boundary: Boundary,
  item: Draft<Extract<InboxItem, { mode: "write" }>>,
) {
  const draft = item.entry as Draft<EntryDraft>;
  if (isStale(boundary, draft)) {
    tx.settleSubmission(item.id, { status: "unanswered", reason: "stale" });
    return;
  }
  const entry = yield* Effect.promise(() => tx.appendEntry(boundary.conversationId, draft));
  if (draft.head !== undefined) boundary.head = draft.head === "self" ? entry.id : draft.head;
  tx.placeSubmission(item.id, entry.id);
});

const applyUser = Effect.fn("applyUser")(function* (
  tx: Tx,
  conversationId: ConversationId,
  item: Draft<Extract<InboxItem, { mode: "steer" | "followUp" }>>,
  now: number,
) {
  const entry = yield* appendInput(
    tx,
    conversationId,
    item.content as UserInput,
    item.entry as InputEntry,
    now,
  );
  tx.placeSubmission(item.id, entry.id);
  return item.id;
});

export const applyBoundary: Dual4<
  Tx,
  Boundary,
  "postTools" | "final",
  number,
  Effect.Effect<BoundaryResult>
> = Function.dual(
  4,
  Effect.fn("applyBoundary")(function* (
    tx: Tx,
    boundary: Boundary,
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
        applyWrite(tx, boundary, items[index] as Draft<Extract<InboxItem, { mode: "write" }>>),
      { discard: true },
    );
    const placed = yield* Effect.forEach(users, (index) =>
      applyUser(
        tx,
        conversationId,
        items[index] as Draft<Extract<InboxItem, { mode: "steer" | "followUp" }>>,
        now,
      ),
    );
    const removed = [...writes, ...users].sort((a, b) => b - a);
    for (const index of removed) items.splice(index, 1);
    return { users: placed, reset };
  }),
);

export const appendInput: Dual5<
  Tx,
  ConversationId,
  UserInput,
  InputEntry | undefined,
  number,
  Effect.Effect<EntryRecord>
> = Function.dual(
  5,
  (
    tx: Tx,
    conversationId: ConversationId,
    content: UserInput,
    entry: InputEntry | undefined,
    now: number,
  ): Effect.Effect<EntryRecord> => {
    const message = { role: "user", content, timestamp: now } as const;
    return Effect.promise(() =>
      entry === undefined
        ? tx.appendEntry(UserEntry, conversationId, { model: [message] })
        : tx.appendEntry(conversationId, { ...pickInputEntry(entry), model: [message] }),
    );
  },
);

export function pickInputEntry({ kind, data }: InputEntry): JsonRepresentation<InputEntry> {
  const picked = data === undefined ? { kind } : { kind, data };
  return copyJson(picked, { omitUndefinedProperties: true }) as JsonRepresentation<InputEntry>;
}

export function isDisplayOnly(entry: EntryDraft): boolean {
  return entry.model === undefined && entry.head === undefined && entry.edits === undefined;
}

export function hasQueuedReset(items: readonly InboxItem[]): boolean {
  return items.some((item) => item.mode === "write" && item.entry["head"] === "self");
}

export const isStale: Dual2<Boundary, EntryDraft, boolean> = Function.dual(
  2,
  (boundary: Boundary, entry: EntryDraft): boolean =>
    typeof entry.head === "number" && boundary.head !== undefined && entry.head < boundary.head,
);

export const removeInboxItem: Dual3<
  Tx,
  ConversationId,
  SubmissionId,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fn("removeInboxItem")(function* (
    tx: Tx,
    conversationId: ConversationId,
    id: SubmissionId,
  ) {
    const items = (yield* Effect.promise(() => tx.doc(InboxDoc, conversationId))).items;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) items.splice(index, 1);
  }),
);

export const withdrawQueuedInputs: Dual2<Tx, ConversationId, Effect.Effect<void>> = Function.dual(
  2,
  Effect.fn("withdrawQueuedInputs")(function* (tx: Tx, conversationId: ConversationId) {
    const items = (yield* Effect.promise(() => tx.doc(InboxDoc, conversationId))).items;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index]!;
      if (item.mode === "write") continue;
      tx.settleSubmission(item.id, { status: "unanswered", reason: "aborted" });
      items.splice(index, 1);
    }
  }),
);
