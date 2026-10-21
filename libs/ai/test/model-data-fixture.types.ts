import type modelDataTypes from "../scripts/model-data.types.ts";

declare namespace modelDataFixtureTypes {
  interface ModelDataFixture {
    readonly dataDir: string;
    readonly packageRoot: string;
    readonly structure: modelDataTypes.ModelDataStructure;
    readonly values: Record<string, unknown>;
  }

  interface FixtureData {
    readonly dataDir: string;
    readonly structure: modelDataTypes.ModelDataStructure;
    readonly values: Record<string, unknown>;
    readonly schemaVersion?: number | undefined;
    readonly apiGroup?: string | undefined;
  }
}

export type { modelDataFixtureTypes as default };
