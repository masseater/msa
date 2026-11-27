import type { TSchema } from "typebox";

declare namespace schemaArtifactsTypes {
  interface SchemaArtifact {
    filename: `${string}.schema.json`;
    schema: TSchema;
    definitions?: Readonly<Record<string, TSchema>>;
  }
}

export type { schemaArtifactsTypes as default };
