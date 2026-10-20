import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import documents from "../documents.ts";
import type dualTypes from "../dual.ts";
import type typesModule from "../types.types.ts";
import type forksTypes from "./forks.types.ts";

const { addressId } = documents;

const SCAN_PAGE_SIZE = 256;

type ForkPolicy = "asOf" | "current";

type CopyCollection = {
  readonly storage: typesModule.Storage;
  readonly childConversationId: typesModule.ConversationId;
  readonly copies: forksTypes.ForkDocumentCopy[];
  readonly copiedAddresses: Set<string>;
  readonly context: Context;
};

type ConversationScope = Extract<
  typesModule.DocumentRecord["scope"],
  { readonly kind: "conversation" }
>;
type ConversationDocument = Extract<
  typesModule.DocumentRecord,
  { readonly scope: ConversationScope }
>;

const isConversationDocument = (
  record: typesModule.DocumentRecord,
): record is ConversationDocument => record.scope.kind === "conversation";

const copyRecord = (
  source: ConversationDocument,
  id: typesModule.DocumentId,
  child: typesModule.ConversationId,
) => {
  const identity = {
    id,
    kind: source.kind,
    ...(source.key === undefined ? {} : { key: source.key }),
    scope: { conversationId: child, kind: "conversation" as const },
  };
  const record: typesModule.DocumentCreate =
    source.history === "latest"
      ? { ...identity, fork: source.fork, history: "latest" }
      : { ...identity, fork: source.fork, history: "rewindable" };
  return record;
};

const scanPage = (
  collection: CopyCollection,
  scope: ConversationScope,
  at: typesModule.DocumentPoint,
  cursor: typesModule.Cursor | undefined,
) =>
  Effect.promise(() =>
    collection.storage.scanDocuments({ at, scope }, SCAN_PAGE_SIZE, cursor, collection.context),
  );

const collectCopies = Effect.fnUntraced(function* (
  collection: CopyCollection,
  scope: ConversationScope,
  at: typesModule.DocumentPoint,
  policy: ForkPolicy,
) {
  const { storage } = collection;
  let cursor: typesModule.Cursor | undefined;
  do {
    const page = yield* scanPage(collection, scope, at, cursor);
    for (const source of page.items) {
      if (!isConversationDocument(source) || source.fork !== policy) continue;
      const id = yield* Effect.promise(() => storage.mintId<typesModule.DocumentId>());
      const record = copyRecord(source, id, collection.childConversationId);
      const copyAddress = addressId(record);
      if (collection.copiedAddresses.has(copyAddress)) {
        const member = record.key === undefined ? record.kind : `${record.kind}/${record.key}`;
        throw new Error(`Fork selects multiple source documents for ${member}`);
      }
      collection.copiedAddresses.add(copyAddress);
      collection.copies.push({ record, source: { at, id: source.id } });
    }
    cursor = page.next;
  } while (cursor !== undefined);
});

const prepareForkDocumentCopies: dualTypes.Dual5<
  typesModule.Storage,
  typesModule.ConversationId,
  typesModule.EntryId,
  typesModule.ConversationId,
  Context,
  Effect.Effect<readonly forksTypes.ForkDocumentCopy[]>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    storage: typesModule.Storage,
    parentConversationId: typesModule.ConversationId,
    at: typesModule.EntryId,
    childConversationId: typesModule.ConversationId,
    context: Context,
  ) {
    const entry = yield* Effect.promise(() => storage.entry(parentConversationId, at, context));
    if (entry === undefined)
      throw new Error(`Entry ${at} is not visible from conversation ${parentConversationId}`);
    const collection: CopyCollection = {
      childConversationId,
      context,
      copiedAddresses: new Set(),
      copies: [],
      storage,
    };
    yield* collectCopies(
      collection,
      { conversationId: entry.entry.conversationId, kind: "conversation" },
      entry.commitSeq,
      "asOf",
    );
    yield* collectCopies(
      collection,
      { conversationId: parentConversationId, kind: "conversation" },
      "current",
      "current",
    );
    return collection.copies;
  }),
);

const forks = {
  prepareForkDocumentCopies,
};

export default forks;
