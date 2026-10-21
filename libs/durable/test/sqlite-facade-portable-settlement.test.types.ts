import type nodeTypes from "../src/storage/sqlite/node.types.ts";
import type typesModule from "../src/types.types.ts";

declare namespace sqliteFacadePortableSettlementTestTypes {
  type NodeSqliteDatabase = nodeTypes.NodeSqliteDatabase;

  type DocumentId = typesModule.DocumentId;

  type EntryId = typesModule.EntryId;
}

export type { sqliteFacadePortableSettlementTestTypes as default };
