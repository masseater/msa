import type storeRowTypes from "./store-row.types.ts";
import type storeTypesTypes from "./store-types.types.ts";
import storeVectors from "./store-vectors.ts";

const { decodeVector } = storeVectors;

function toRecord(row: storeRowTypes.MemoryRow): storeTypesTypes.MemoryRecord {
  return {
    content: row.content,
    createdAt: row.created_at,
    embedding: row.embedding === null ? null : decodeVector(row.embedding),
    embeddingModel: row.embedding_model,
    id: row.id,
    kind: row.kind as storeTypesTypes.MemoryKind,
    lastUsedAt: row.last_used_at,
    project: row.project,
    scope: row.scope as storeTypesTypes.MemoryScope,
    updatedAt: row.updated_at,
    useCount: row.use_count,
  };
}

const storeRow = {
  toRecord,
};

export default storeRow;
