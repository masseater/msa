export type {
  AttributeValue,
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetryLogRecord,
  TelemetryLogSeverity,
  TelemetryMetricKind,
  TelemetryMetricRecord,
  TelemetrySpan,
} from "./context.ts";
export { NOOP_TELEMETRY_CONTEXT } from "./noop.ts";
export type {
  TelemetryAttributeDefinition,
  TelemetryAttributeMetadata,
  TelemetryAttributeType,
  TelemetryEventAttributeDefinition,
  TelemetryEventDefinition,
  TelemetryParentDefinition,
  TelemetrySchemaDefinition,
  TelemetrySpanDefinition,
  TelemetryStartAttributeDefinition,
} from "./schema.ts";
export { defineTelemetrySchema } from "./schema.ts";
export type {
  ExactTelemetryAttributes,
  InferEventAttributes,
  InferOptionalAttributes,
  InferRequiredAndOptionalAttributes,
  InferStartAttributes,
  SchemaTelemetrySpan,
  TelemetrySchemaSpanEndAttributes,
  TelemetrySchemaSpanEventAttributes,
  TelemetrySchemaSpanEventName,
  TelemetrySchemaSpanName,
  TelemetrySchemaSpanStartAttributes,
  TelemetrySchemaSpanUnion,
} from "./schema-inference.ts";
export type { TypedSpanStarter } from "./typed-span-starter.ts";
export { createTypedSpanStarter } from "./typed-span-starter.ts";
export type {
  RecordedTelemetryEvent,
  RecordedTelemetryLog,
  RecordedTelemetryMetric,
  RecordedTelemetrySpan,
} from "./memory.ts";
export { InMemoryTelemetryContext } from "./memory.ts";
