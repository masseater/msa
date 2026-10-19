import type { TelemetryContext } from "../context.ts";
import type {
  RecordedTelemetryLog,
  RecordedTelemetryMetric,
  RecordedTelemetrySpan,
} from "../memory.ts";

export interface TelemetryAdapterFixture extends AsyncDisposable {
  readonly context: TelemetryContext;
  getSpans(): Promise<readonly RecordedTelemetrySpan[]>;
  getLogs(): Promise<readonly RecordedTelemetryLog[]>;
  getMetrics(): Promise<readonly RecordedTelemetryMetric[]>;
}

export type TelemetryAdapterFixtureFactory = () => Promise<TelemetryAdapterFixture>;

export interface TelemetryAdapterConformanceCase {
  readonly group: string;
  readonly name: string;
  run(): Promise<void>;
}
