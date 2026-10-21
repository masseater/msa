import type contextTypes from "../context.ts";
import type memoryTypes from "../memory.types.ts";

declare namespace typesModule {
  interface TelemetryAdapterFixture extends AsyncDisposable {
    readonly context: contextTypes.TelemetryContext;
    getSpans(): Promise<readonly memoryTypes.RecordedTelemetrySpan[]>;
    getLogs(): Promise<readonly memoryTypes.RecordedTelemetryLog[]>;
    getMetrics(): Promise<readonly memoryTypes.RecordedTelemetryMetric[]>;
  }

  type TelemetryAdapterFixtureFactory = () => Promise<TelemetryAdapterFixture>;

  interface TelemetryAdapterConformanceCase {
    readonly group: string;
    readonly name: string;
    run(): Promise<void>;
  }
}

export type { typesModule as default };
