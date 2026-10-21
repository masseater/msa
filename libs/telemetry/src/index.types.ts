import type contextTypes from "./context.ts";
import type memoryTypes from "./memory.types.ts";
import type schemaInferenceTypes from "./schema-inference.ts";
import type schemaTypes from "./schema.types.ts";
import type typedSpanStarterTypes from "./typed-span-starter.types.ts";

declare namespace telemetryTypes {
  type AttributeValue = contextTypes.AttributeValue;

  type SpanAttributes = contextTypes.SpanAttributes;

  type SpanOptions = contextTypes.SpanOptions;

  type SpanStatus = contextTypes.SpanStatus;

  type TelemetryContext = contextTypes.TelemetryContext;

  type TelemetryLogRecord = contextTypes.TelemetryLogRecord;

  type TelemetryLogSeverity = contextTypes.TelemetryLogSeverity;

  type TelemetryMetricKind = contextTypes.TelemetryMetricKind;

  type TelemetryMetricRecord = contextTypes.TelemetryMetricRecord;

  type TelemetrySpan = contextTypes.TelemetrySpan;

  type TelemetryAttributeDefinition = schemaTypes.TelemetryAttributeDefinition;

  type TelemetryAttributeMetadata = schemaTypes.TelemetryAttributeMetadata;

  type TelemetryAttributeType = schemaTypes.TelemetryAttributeType;

  type TelemetryEventAttributeDefinition = schemaTypes.TelemetryEventAttributeDefinition;

  type TelemetryEventDefinition = schemaTypes.TelemetryEventDefinition;

  type TelemetryParentDefinition = schemaTypes.TelemetryParentDefinition;

  type TelemetrySchemaDefinition = schemaTypes.TelemetrySchemaDefinition;

  type TelemetrySpanDefinition = schemaTypes.TelemetrySpanDefinition;

  type TelemetryStartAttributeDefinition = schemaTypes.TelemetryStartAttributeDefinition;

  type ExactTelemetryAttributes<
    Expected,
    Actual extends Expected,
  > = schemaInferenceTypes.ExactTelemetryAttributes<Expected, Actual>;

  type InferEventAttributes<
    Definitions extends Record<string, schemaTypes.TelemetryEventAttributeDefinition>,
  > = schemaInferenceTypes.InferEventAttributes<Definitions>;

  type InferOptionalAttributes<
    Definitions extends Record<string, schemaTypes.TelemetryAttributeDefinition>,
  > = schemaInferenceTypes.InferOptionalAttributes<Definitions>;

  type InferRequiredAndOptionalAttributes<
    Definitions extends Record<
      string,
      schemaTypes.TelemetryStartAttributeDefinition | schemaTypes.TelemetryEventAttributeDefinition
    >,
  > = schemaInferenceTypes.InferRequiredAndOptionalAttributes<Definitions>;

  type InferStartAttributes<
    Definitions extends Record<string, schemaTypes.TelemetryStartAttributeDefinition>,
  > = schemaInferenceTypes.InferStartAttributes<Definitions>;

  type SchemaTelemetrySpan<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = schemaInferenceTypes.SchemaTelemetrySpan<Schema, Name>;

  type TelemetrySchemaSpanEndAttributes<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = schemaInferenceTypes.TelemetrySchemaSpanEndAttributes<Schema, Name>;

  type TelemetrySchemaSpanEventAttributes<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
    EventName extends TelemetrySchemaSpanEventName<Schema, Name>,
  > = schemaInferenceTypes.TelemetrySchemaSpanEventAttributes<Schema, Name, EventName>;

  type TelemetrySchemaSpanEventName<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = schemaInferenceTypes.TelemetrySchemaSpanEventName<Schema, Name>;

  type TelemetrySchemaSpanName<Schema extends schemaTypes.TelemetrySchemaDefinition> =
    schemaInferenceTypes.TelemetrySchemaSpanName<Schema>;

  type TelemetrySchemaSpanStartAttributes<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = schemaInferenceTypes.TelemetrySchemaSpanStartAttributes<Schema, Name>;

  type TelemetrySchemaSpanUnion<Schema extends schemaTypes.TelemetrySchemaDefinition> =
    schemaInferenceTypes.TelemetrySchemaSpanUnion<Schema>;

  type TypedSpanStarter<Schemas extends typedSpanStarterTypes.TelemetrySchemaTuple> =
    typedSpanStarterTypes.TypedSpanStarter<Schemas>;

  type RecordedTelemetryEvent = memoryTypes.RecordedTelemetryEvent;

  type RecordedTelemetryLog = memoryTypes.RecordedTelemetryLog;

  type RecordedTelemetryMetric = memoryTypes.RecordedTelemetryMetric;

  type RecordedTelemetrySpan = memoryTypes.RecordedTelemetrySpan;

  type InMemoryTelemetryContext = memoryTypes.InMemoryTelemetryContext;
}

export type { telemetryTypes as default };
