import { dual } from "effect/Function";

import type contextTypes from "./context.ts";
import type schemaInferenceTypes from "./schema-inference.ts";
import type schemaTypes from "./schema.types.ts";
import type typedSpanStarterTypes from "./typed-span-starter.types.ts";

type DuplicateTelemetrySpanNames<
  Schemas extends readonly schemaTypes.TelemetrySchemaDefinition[],
  Seen extends string = never,
> = Schemas extends readonly [
  infer Schema extends schemaTypes.TelemetrySchemaDefinition,
  ...infer Rest extends readonly schemaTypes.TelemetrySchemaDefinition[],
]
  ?
      | Extract<schemaInferenceTypes.TelemetrySchemaSpanName<Schema>, Seen>
      | DuplicateTelemetrySpanNames<
          Rest,
          Seen | schemaInferenceTypes.TelemetrySchemaSpanName<Schema>
        >
  : never;

type UniqueTelemetrySchemas<Schemas extends typedSpanStarterTypes.TelemetrySchemaTuple> = [
  DuplicateTelemetrySpanNames<Schemas>,
] extends [never]
  ? unknown
  : { readonly "duplicate telemetry span names": DuplicateTelemetrySpanNames<Schemas> };

function bindTypedSpanStarter<Schemas extends typedSpanStarterTypes.TelemetrySchemaTuple>(
  telemetryContext: contextTypes.TelemetryContext,
): typedSpanStarterTypes.TypedSpanStarter<Schemas> {
  const startSpan = (
    name: typedSpanStarterTypes.SpanNameInSchemas<Schemas>,
    attributes: contextTypes.SpanAttributes,
    callback: (
      span: typedSpanStarterTypes.SpanInSchema<
        Schemas[number],
        typedSpanStarterTypes.SpanNameInSchemas<Schemas>
      >,
      startChildSpan: typedSpanStarterTypes.TypedSpanStarter<Schemas>,
    ) => unknown,
  ): Promise<unknown> =>
    telemetryContext.startSpan({ attributes, name }, (span) =>
      callback(
        span as typedSpanStarterTypes.SpanInSchema<
          Schemas[number],
          typedSpanStarterTypes.SpanNameInSchemas<Schemas>
        >,
        bindTypedSpanStarter<Schemas>(span),
      ),
    );

  return startSpan as typedSpanStarterTypes.TypedSpanStarter<Schemas>;
}

type CreateTypedSpanStarterDataFirst = <
  const Schemas extends typedSpanStarterTypes.TelemetrySchemaTuple,
>(
  telemetryContext: contextTypes.TelemetryContext,
  schemas: Schemas & UniqueTelemetrySchemas<Schemas>,
) => typedSpanStarterTypes.TypedSpanStarter<Schemas>;

type CreateTypedSpanStarterDataLast = <
  const Schemas extends typedSpanStarterTypes.TelemetrySchemaTuple,
>(
  schemas: Schemas & UniqueTelemetrySchemas<Schemas>,
) => (
  telemetryContext: contextTypes.TelemetryContext,
) => typedSpanStarterTypes.TypedSpanStarter<Schemas>;

const createTypedSpanStarter = dual<
  CreateTypedSpanStarterDataLast,
  CreateTypedSpanStarterDataFirst
>(
  2,
  <const Schemas extends typedSpanStarterTypes.TelemetrySchemaTuple>(
    telemetryContext: contextTypes.TelemetryContext,
  ): typedSpanStarterTypes.TypedSpanStarter<Schemas> =>
    bindTypedSpanStarter<Schemas>(telemetryContext),
);

const typedSpanStarter = {
  createTypedSpanStarter,
};

export default typedSpanStarter;
