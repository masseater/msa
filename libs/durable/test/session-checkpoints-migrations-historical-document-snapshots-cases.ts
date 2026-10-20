import durable from "@msa/durable";

import type sessionCheckpointsMigrationsHistoricalDocumentSnapshotsCasesTypes from "./session-checkpoints-migrations-historical-document-snapshots-cases.types.ts";

const { defineDoc } = durable;

const V1Doc = defineDoc<sessionCheckpointsMigrationsHistoricalDocumentSnapshotsCasesTypes.V1>({
  initial: () => ({ name: "first" }),
  kind: "cache.versioned",
  scope: "session",
  version: 1,
});

const V2Doc = defineDoc<sessionCheckpointsMigrationsHistoricalDocumentSnapshotsCasesTypes.V2>({
  initial: () => ({ names: [] }),
  kind: "cache.versioned",
  migrate: (value) => ({ names: [value["name"] as string] }),
  scope: "session",
  version: 2,
});

const sessionCheckpointsMigrationsHistoricalDocumentSnapshotsCases = {
  V1Doc,
  V2Doc,
};

export default sessionCheckpointsMigrationsHistoricalDocumentSnapshotsCases;
