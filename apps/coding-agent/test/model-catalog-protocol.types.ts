declare namespace modelCatalogProtocolTypes {
  type ModelCatalogArtifact = "models.json" | "models.all.json" | "providers.json";

  type ModelCatalogRepresentation = "legacy" | "typed";

  type ModelCatalogIndexEntry = {
    minimumPiVersion: string;
    revision: string;
  };

  type ModelCatalogIndex = {
    schemaVersion: number;
    defaultRevision: string;
    catalogs: ModelCatalogIndexEntry[];
  };

  type ModelCatalogRequest =
    | { kind: "catalog"; piVersion: string | undefined; representation: ModelCatalogRepresentation }
    | { kind: "redirect"; location: string }
    | { kind: "invalid"; error: string };
}

export type { modelCatalogProtocolTypes as default };
