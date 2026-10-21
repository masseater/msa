import type sqliteTypes from "../src/storage/sqlite/index.types.ts";
import type typesModule from "../src/types.types.ts";

declare namespace sqliteMigrationsTestTypes {
  type SqliteMigration = sqliteTypes.SqliteMigration;

  type EntryId = typesModule.EntryId;
}

export type { sqliteMigrationsTestTypes as default };
