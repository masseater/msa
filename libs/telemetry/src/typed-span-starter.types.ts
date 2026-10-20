import type schemaInferenceTypes from "./schema-inference.ts";
import type schemaTypes from "./schema.types.ts";

declare namespace typedSpanStarterTypes {
  type TelemetrySchemaTuple = readonly [
    schemaTypes.TelemetrySchemaDefinition,
    ...schemaTypes.TelemetrySchemaDefinition[],
  ];

  type SpanNameInSchema<Schema extends schemaTypes.TelemetrySchemaDefinition> =
    Schema extends schemaTypes.TelemetrySchemaDefinition
      ? schemaInferenceTypes.TelemetrySchemaSpanName<Schema>
      : never;

  type SpanNameInSchemas<Schemas extends TelemetrySchemaTuple> = SpanNameInSchema<Schemas[number]>;

  type SpanStartAttributesInSchema<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends string,
  > = Schema extends schemaTypes.TelemetrySchemaDefinition
    ? Name extends schemaInferenceTypes.TelemetrySchemaSpanName<Schema>
      ? schemaInferenceTypes.TelemetrySchemaSpanStartAttributes<Schema, Name>
      : never
    : never;

  type SpanInSchema<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends string,
  > = Schema extends schemaTypes.TelemetrySchemaDefinition
    ? Name extends schemaInferenceTypes.TelemetrySchemaSpanName<Schema>
      ? schemaInferenceTypes.SchemaTelemetrySpan<Schema, Name>
      : never
    : never;

  type UnionToIntersection<Union> = (
    Union extends unknown ? (value: Union) => void : never
  ) extends (value: infer Intersection) => void
    ? Intersection
    : never;

  type TypedSpanStarterForName<
    Schemas extends TelemetrySchemaTuple,
    Name extends SpanNameInSchemas<Schemas>,
  > = <const Attributes extends SpanStartAttributesInSchema<Schemas[number], Name>, Result>(
    name: Name,
    attributes: schemaInferenceTypes.ExactTelemetryAttributes<
      SpanStartAttributesInSchema<Schemas[number], Name>,
      Attributes
    >,
    callback: (
      span: SpanInSchema<Schemas[number], Name>,
      startChildSpan: TypedSpanStarter<Schemas>,
    ) => Result | Promise<Result>,
  ) => Promise<Result>;

  type TypedSpanStarter<Schemas extends TelemetrySchemaTuple> = UnionToIntersection<
    {
      [Name in SpanNameInSchemas<Schemas>]: TypedSpanStarterForName<Schemas, Name>;
    }[SpanNameInSchemas<Schemas>]
  >;
}

export type { typedSpanStarterTypes as default };
