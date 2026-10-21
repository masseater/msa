declare namespace migrationsTypes {
  type SqliteMigration = {
    readonly version: number;
    readonly statements: readonly string[];
  };
}

export type { migrationsTypes as default };
