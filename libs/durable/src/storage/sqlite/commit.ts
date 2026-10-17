import { Effect, Function } from "effect";

import { seqFromNumber } from "../../ids.ts";
import type { DocumentId, Seq, StorageWrite } from "../../types.ts";
import { type DocumentAction, type MetadataRow, writeId } from "./codec.ts";
import type { SqliteExecutor } from "./database.ts";
import { checkDocumentActions } from "./documents.ts";
import { applyDocumentActions, applyTableWrite, checkGlobalIds } from "./writes.ts";

const METADATA = "SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1";

export const readMetadata = (executor: SqliteExecutor): Effect.Effect<MetadataRow> =>
  Effect.map(
    Effect.promise(() => executor.get<MetadataRow>(METADATA)),
    (metadata) => {
      if (metadata === undefined) throw new Error("Durable SQLite metadata is missing");
      return metadata;
    },
  );

export const commitIn: {
  (
    writes: readonly StorageWrite[],
    documentActions: ReadonlyMap<DocumentId, DocumentAction>,
    candidateNextId: number,
  ): (transaction: SqliteExecutor) => Effect.Effect<Seq>;
  (
    transaction: SqliteExecutor,
    writes: readonly StorageWrite[],
    documentActions: ReadonlyMap<DocumentId, DocumentAction>,
    candidateNextId: number,
  ): Effect.Effect<Seq>;
} = Function.dual(
  4,
  Effect.fn("commitIn")(function* (
    transaction: SqliteExecutor,
    writes: readonly StorageWrite[],
    documentActions: ReadonlyMap<DocumentId, DocumentAction>,
    candidateNextId: number,
  ) {
    const metadata = yield* readMetadata(transaction);
    const committedSeq = seqFromNumber(metadata.next_seq);
    yield* checkGlobalIds(transaction, writes);
    yield* checkDocumentActions(transaction, documentActions);
    yield* Effect.forEach(writes, (write) => applyTableWrite(transaction, write, committedSeq), {
      discard: true,
    });
    yield* applyDocumentActions(transaction, documentActions, committedSeq);
    yield* Effect.promise(() =>
      transaction.run(
        "UPDATE durable_metadata SET next_id = ?, next_seq = ? WHERE singleton = 1",
        String(Math.max(Number(metadata.next_id), candidateNextId)),
        committedSeq + 1,
      ),
    );
    return committedSeq;
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
