declare namespace modelDataChecksTypes {
  interface StringListComparison {
    readonly expected: readonly string[];
    readonly actual: readonly string[];
  }

  interface ModelValueExpectation {
    readonly value: unknown;
    readonly providerId: string;
    readonly modelId: string;
    readonly api: string;
  }

  interface ManifestExpectation {
    readonly manifest: Record<string, unknown> | undefined;
    readonly schemaVersion: number;
    readonly structureHash: string;
    readonly expectedFiles: readonly string[];
  }

  interface StoredGroups {
    readonly path: string;
    readonly groups: Record<string, unknown>;
  }

  interface ProviderGroups {
    readonly providerId: string;
    readonly filename: string;
    readonly groups: Record<string, unknown>;
  }

  interface ApiPlacement {
    readonly providerId: string;
    readonly expectedModels: Readonly<Record<string, string>>;
    readonly actualModels: ReadonlyMap<string, string>;
  }
}

export type { modelDataChecksTypes as default };
