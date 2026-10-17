import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { addressId } from "../documents.ts";
import type { Dual5 } from "../dual.ts";
import type {
  ConversationId,
  Cursor,
  DocumentCopySource,
  DocumentCreate,
  DocumentId,
  DocumentPoint,
  DocumentRecord,
  EntryId,
  Storage,
} from "../types.ts";

const SCAN_PAGE_SIZE = 256;

type ForkPolicy = "asOf" | "current";

export type ForkDocumentCopy = {
  readonly record: DocumentCreate;
  readonly source: DocumentCopySource;
};

type CopyCollection = {
  readonly storage: Storage;
  readonly childConversationId: ConversationId;
  readonly copies: ForkDocumentCopy[];
  readonly copiedAddresses: Set<string>;
  readonly context: Context;
};

type ConversationScope = Extract<DocumentRecord["scope"], { readonly kind: "conversation" }>;
type ConversationDocument = Extract<DocumentRecord, { readonly scope: ConversationScope }>;

const isConversationDocument = (record: DocumentRecord): record is ConversationDocument =>
  record.scope.kind === "conversation";

const copyRecord = (source: ConversationDocument, id: DocumentId, child: ConversationId) => {
  const identity = {
    id,
    kind: source.kind,
    ...(source.key === undefined ? {} : { key: source.key }),
    scope: { kind: "conversation" as const, conversationId: child },
  };
  const record: DocumentCreate =
    source.history === "latest"
      ? { ...identity, history: "latest", fork: source.fork }
      : { ...identity, history: "rewindable", fork: source.fork };
  return record;
};

const scanPage = (
  collection: CopyCollection,
  scope: ConversationScope,
  at: DocumentPoint,
  cursor: Cursor | undefined,
) =>
  Effect.promise(() =>
    collection.storage.scanDocuments({ scope, at }, SCAN_PAGE_SIZE, cursor, collection.context),
  );

const collectCopies = Effect.fnUntraced(function* (
  collection: CopyCollection,
  scope: ConversationScope,
  at: DocumentPoint,
  policy: ForkPolicy,
) {
  const { storage } = collection;
  let cursor: Cursor | undefined;
  do {
    const page = yield* scanPage(collection, scope, at, cursor);
    for (const source of page.items) {
      if (!isConversationDocument(source) || source.fork !== policy) continue;
      const id = yield* Effect.promise(() => storage.mintId<DocumentId>());
      const record = copyRecord(source, id, collection.childConversationId);
      const copyAddress = addressId(record);
      if (collection.copiedAddresses.has(copyAddress)) {
        const member = record.key === undefined ? record.kind : `${record.kind}/${record.key}`;
        throw new Error(`Fork selects multiple source documents for ${member}`);
      }
      collection.copiedAddresses.add(copyAddress);
      collection.copies.push({ record, source: { id: source.id, at } });
    }
    cursor = page.next;
  } while (cursor !== undefined);
});

export const prepareForkDocumentCopies: Dual5<
  Storage,
  ConversationId,
  EntryId,
  ConversationId,
  Context,
  Effect.Effect<readonly ForkDocumentCopy[]>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    storage: Storage,
    parentConversationId: ConversationId,
    at: EntryId,
    childConversationId: ConversationId,
    context: Context,
  ) {
    const entry = yield* Effect.promise(() => storage.entry(parentConversationId, at, context));
    if (entry === undefined)
      throw new Error(`Entry ${at} is not visible from conversation ${parentConversationId}`);
    const collection: CopyCollection = {
      storage,
      childConversationId,
      copies: [],
      copiedAddresses: new Set(),
      context,
    };
    yield* collectCopies(
      collection,
      { kind: "conversation", conversationId: entry.entry.conversationId },
      entry.commitSeq,
      "asOf",
    );
    yield* collectCopies(
      collection,
      { kind: "conversation", conversationId: parentConversationId },
      "current",
      "current",
    );
    return collection.copies;
  }),
);
