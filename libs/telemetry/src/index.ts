import InMemoryTelemetryContext from "./memory.ts";
import noop from "./noop.ts";
import schemaModule from "./schema.ts";
import typedSpanStarter from "./typed-span-starter.ts";

const telemetry: {
  readonly InMemoryTelemetryContext: typeof InMemoryTelemetryContext;
  readonly NOOP_TELEMETRY_CONTEXT: typeof noop.NOOP_TELEMETRY_CONTEXT;
  readonly createTypedSpanStarter: typeof typedSpanStarter.createTypedSpanStarter;
  readonly defineTelemetrySchema: typeof schemaModule.defineTelemetrySchema;
} = {
  InMemoryTelemetryContext: InMemoryTelemetryContext,
  NOOP_TELEMETRY_CONTEXT: noop.NOOP_TELEMETRY_CONTEXT,
  createTypedSpanStarter: typedSpanStarter.createTypedSpanStarter,
  defineTelemetrySchema: schemaModule.defineTelemetrySchema,
};

export default telemetry;
