import { Effect, Function } from "effect";

import ids from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import codec from "./codec.ts";
import type codecTypes from "./codec.types.ts";
import type databaseTypes from "./database.ts";
import documents from "./documents.ts";
import writesModule from "./writes.ts";

const { seqFromNumber } = ids;
const { applyDocumentActions, applyTableWrite, checkGlobalIds, sequence } = writesModule;
const { checkDocumentActions } = documents;
const { writeId } = codec;

const METADATA = "SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1";

const readMetadata = (
  executor: databaseTypes.SqliteExecutor,
): Effect.Effect<codecTypes.MetadataRow> =>
  Effect.map(
    Effect.promise(() => executor.get<codecTypes.MetadataRow>(METADATA)),
    (metadata) => {
      if (metadata === undefined) throw new Error("Durable SQLite metadata is missing");
      return metadata;
    },
  );

const readMetadataRow = (executor: databaseTypes.SqliteExecutor): Promise<codecTypes.MetadataRow> =>
  executor.get<codecTypes.MetadataRow>(METADATA).then((metadata) => {
    if (metadata === undefined) throw new Error("Durable SQLite metadata is missing");
    return metadata;
  });

const documentStep = (
  actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
  step: Effect.Effect<void>,
) => (actions.size === 0 ? Promise.resolve() : Effect.runPromise(step));

const commitIn: {
  (
    writes: readonly typesModule.StorageWrite[],
    documentActions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
    candidateNextId: number,
  ): (transaction: databaseTypes.SqliteExecutor) => Promise<typesModule.Seq>;
  (
    transaction: databaseTypes.SqliteExecutor,
    writes: readonly typesModule.StorageWrite[],
    documentActions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
    candidateNextId: number,
  ): Promise<typesModule.Seq>;
} = Function.dual(
  4,
  (
    transaction: databaseTypes.SqliteExecutor,
    writes: readonly typesModule.StorageWrite[],
    documentActions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
    candidateNextId: number,
  ): Promise<typesModule.Seq> =>
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

const candidateNextId: {
  (writes: readonly typesModule.StorageWrite[]): (nextId: number) => number;
  (nextId: number, writes: readonly typesModule.StorageWrite[]): number;
} = Function.dual(2, (nextId: number, writes: readonly typesModule.StorageWrite[]): number => {
  let candidate = nextId;
  for (const write of writes) {
    const id = writeId(write);
    if (id !== undefined) candidate = Math.max(candidate, id + 1);
  }
  return candidate;
});

const commit = {
  candidateNextId,
  commitIn,
  readMetadata,
};

export default commit;
