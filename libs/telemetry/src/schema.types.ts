declare namespace schemaTypes {
  type TelemetryAttributeType =
    | "string"
    | "number"
    | "boolean"
    | "string[]"
    | "number[]"
    | "boolean[]";

  interface TelemetryAttributeMetadata {
    description: string;
    sensitive?: boolean;
    cardinality?: "low" | "high";
  }

  type TelemetryAttributeDefinition = TelemetryAttributeMetadata &
    (
      | { type: "string"; values?: readonly string[]; examples?: readonly string[] }
      | { type: "number"; values?: readonly number[]; examples?: readonly number[] }
      | { type: "boolean"; values?: readonly boolean[]; examples?: readonly boolean[] }
      | {
          type: "string[]";
          elementValues?: readonly string[];
          examples?: readonly (readonly string[])[];
        }
      | {
          type: "number[]";
          elementValues?: readonly number[];
          examples?: readonly (readonly number[])[];
        }
      | {
          type: "boolean[]";
          elementValues?: readonly boolean[];
          examples?: readonly (readonly boolean[])[];
        }
    );

  type TelemetryStartAttributeDefinition = TelemetryAttributeDefinition & {
    required: boolean;
  };

  type TelemetryEventAttributeDefinition = TelemetryAttributeDefinition & {
    required: boolean;
  };

  interface TelemetryEventDefinition {
    description: string;
    attributes: Record<string, TelemetryEventAttributeDefinition>;
  }

  type TelemetryParentDefinition =
    | { kind: "any" }
    | { kind: "root_or_external" }
    | { kind: "spans"; spans: readonly string[] };

  interface TelemetrySpanDefinition {
    description: string;
    parents: TelemetryParentDefinition;
    startAttributes: Record<string, TelemetryStartAttributeDefinition>;
    endAttributes: Record<string, TelemetryAttributeDefinition>;
    events?: Record<string, TelemetryEventDefinition>;
    status: { default: "ok"; errorWhen: string };
  }

  interface TelemetrySchemaDefinition {
    version: number;
    spans: Record<string, TelemetrySpanDefinition>;
  }
}

export type { schemaTypes as default };
