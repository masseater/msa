import { Effect, Function } from "effect";

import { seqFromNumber } from "../../ids.ts";
import type { DocumentId, Seq, StorageWrite } from "../../types.ts";
import { type DocumentAction, type MetadataRow, writeId } from "./codec.ts";
import type { SqliteExecutor } from "./database.ts";
import { checkDocumentActions } from "./documents.ts";
import { applyDocumentActions, applyTableWrite, checkGlobalIds, sequence } from "./writes.ts";

const METADATA = "SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1";

export const readMetadata = (executor: SqliteExecutor): Effect.Effect<MetadataRow> =>
  Effect.map(
    Effect.promise(() => executor.get<MetadataRow>(METADATA)),
    (metadata) => {
      if (metadata === undefined) throw new Error("Durable SQLite metadata is missing");
      return metadata;
    },
  );

const readMetadataRow = (executor: SqliteExecutor): Promise<MetadataRow> =>
  executor.get<MetadataRow>(METADATA).then((metadata) => {
    if (metadata === undefined) throw new Error("Durable SQLite metadata is missing");
    return metadata;
  });

const documentStep = (
  actions: ReadonlyMap<DocumentId, DocumentAction>,
  step: Effect.Effect<void>,
) => (actions.size === 0 ? Promise.resolve() : Effect.runPromise(step));

export const commitIn: {
  (
    writes: readonly StorageWrite[],
    documentActions: ReadonlyMap<DocumentId, DocumentAction>,
    candidateNextId: number,
  ): (transaction: SqliteExecutor) => Promise<Seq>;
  (
    transaction: SqliteExecutor,
    writes: readonly StorageWrite[],
    documentActions: ReadonlyMap<DocumentId, DocumentAction>,
    candidateNextId: number,
  ): Promise<Seq>;
} = Function.dual(
  4,
  (
    transaction: SqliteExecutor,
    writes: readonly StorageWrite[],
    documentActions: ReadonlyMap<DocumentId, DocumentAction>,
    candidateNextId: number,
  ): Promise<Seq> =>
    readMetadataRow(transaction).then((metadata) => {
      const committedSeq = seqFromNumber(metadata.next_seq);
      return checkGlobalIds(transaction, writes)
        .then(() =>
          documentStep(documentActions, checkDocumentActions(transaction, documentActions)),
        )
        .then(() => sequence(writes, (write) => applyTableWrite(transaction, write, committedSeq)))
        .then(() =>
          documentStep(
            documentActions,
            applyDocumentActions(transaction, documentActions, committedSeq),
          ),
        )
        .then(() =>
          transaction.run(
            "UPDATE durable_metadata SET next_id = ?, next_seq = ? WHERE singleton = 1",
            String(Math.max(Number(metadata.next_id), candidateNextId)),
            committedSeq + 1,
          ),
        )
        .then(() => committedSeq);
    }),
);

export const candidateNextId: {
  (writes: readonly StorageWrite[]): (nextId: number) => number;
  (nextId: number, writes: readonly StorageWrite[]): number;
} = Function.dual(2, (nextId: number, writes: readonly StorageWrite[]): number => {
  let candidate = nextId;
  for (const write of writes) {
    const id = writeId(write);
    if (id !== undefined) candidate = Math.max(candidate, id + 1);
  }
  return candidate;
});
