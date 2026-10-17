import { dual } from "effect/Function";

import type { SpanAttributes, TelemetryContext } from "./context.ts";
import type {
  ExactTelemetryAttributes,
  SchemaTelemetrySpan,
  TelemetrySchemaSpanName,
  TelemetrySchemaSpanStartAttributes,
} from "./schema-inference.ts";
import type { TelemetrySchemaDefinition } from "./schema.ts";

type TelemetrySchemaTuple = readonly [TelemetrySchemaDefinition, ...TelemetrySchemaDefinition[]];

type SpanNameInSchema<Schema extends TelemetrySchemaDefinition> =
  Schema extends TelemetrySchemaDefinition ? TelemetrySchemaSpanName<Schema> : never;

type SpanNameInSchemas<Schemas extends TelemetrySchemaTuple> = SpanNameInSchema<Schemas[number]>;

type SpanStartAttributesInSchema<
  Schema extends TelemetrySchemaDefinition,
  Name extends string,
> = Schema extends TelemetrySchemaDefinition
  ? Name extends TelemetrySchemaSpanName<Schema>
    ? TelemetrySchemaSpanStartAttributes<Schema, Name>
    : never
  : never;

type SpanInSchema<
  Schema extends TelemetrySchemaDefinition,
  Name extends string,
> = Schema extends TelemetrySchemaDefinition
  ? Name extends TelemetrySchemaSpanName<Schema>
    ? SchemaTelemetrySpan<Schema, Name>
    : never
  : never;

type DuplicateTelemetrySpanNames<
  Schemas extends readonly TelemetrySchemaDefinition[],
  Seen extends string = never,
> = Schemas extends readonly [
  infer Schema extends TelemetrySchemaDefinition,
  ...infer Rest extends readonly TelemetrySchemaDefinition[],
]
  ?
      | Extract<TelemetrySchemaSpanName<Schema>, Seen>
      | DuplicateTelemetrySpanNames<Rest, Seen | TelemetrySchemaSpanName<Schema>>
  : never;

type UniqueTelemetrySchemas<Schemas extends TelemetrySchemaTuple> = [
  DuplicateTelemetrySpanNames<Schemas>,
] extends [never]
  ? unknown
  : { readonly "duplicate telemetry span names": DuplicateTelemetrySpanNames<Schemas> };

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type TypedSpanStarterForName<
  Schemas extends TelemetrySchemaTuple,
  Name extends SpanNameInSchemas<Schemas>,
> = <const Attributes extends SpanStartAttributesInSchema<Schemas[number], Name>, Result>(
  name: Name,
  attributes: ExactTelemetryAttributes<
    SpanStartAttributesInSchema<Schemas[number], Name>,
    Attributes
  >,
  callback: (
    span: SpanInSchema<Schemas[number], Name>,
    startChildSpan: TypedSpanStarter<Schemas>,
  ) => Result | Promise<Result>,
) => Promise<Result>;

export type TypedSpanStarter<Schemas extends TelemetrySchemaTuple> = UnionToIntersection<
  {
    [Name in SpanNameInSchemas<Schemas>]: TypedSpanStarterForName<Schemas, Name>;
  }[SpanNameInSchemas<Schemas>]
>;

function bindTypedSpanStarter<Schemas extends TelemetrySchemaTuple>(
  telemetryContext: TelemetryContext,
): TypedSpanStarter<Schemas> {
  const startSpan = (
    name: SpanNameInSchemas<Schemas>,
    attributes: SpanAttributes,
    callback: (
      span: SpanInSchema<Schemas[number], SpanNameInSchemas<Schemas>>,
      startChildSpan: TypedSpanStarter<Schemas>,
    ) => unknown,
  ): Promise<unknown> =>
    telemetryContext.startSpan({ name, attributes }, (span) =>
      callback(
        span as SpanInSchema<Schemas[number], SpanNameInSchemas<Schemas>>,
        bindTypedSpanStarter<Schemas>(span),
      ),
    );

  return startSpan as TypedSpanStarter<Schemas>;
}

type CreateTypedSpanStarterDataFirst = <const Schemas extends TelemetrySchemaTuple>(
  telemetryContext: TelemetryContext,
  schemas: Schemas & UniqueTelemetrySchemas<Schemas>,
) => TypedSpanStarter<Schemas>;

type CreateTypedSpanStarterDataLast = <const Schemas extends TelemetrySchemaTuple>(
  schemas: Schemas & UniqueTelemetrySchemas<Schemas>,
) => (telemetryContext: TelemetryContext) => TypedSpanStarter<Schemas>;

export const createTypedSpanStarter = dual<
  CreateTypedSpanStarterDataLast,
  CreateTypedSpanStarterDataFirst
>(
  2,
  <const Schemas extends TelemetrySchemaTuple>(
    telemetryContext: TelemetryContext,
  ): TypedSpanStarter<Schemas> => bindTypedSpanStarter<Schemas>(telemetryContext),
);
