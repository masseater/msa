import type otlp from "./otlp.ts";

declare namespace otlpTypes {
  interface OtlpTelemetryOptions {
    readonly endpoint: string;
    readonly serviceName: string;
    readonly serviceVersion: string;
  }

  type OtlpTelemetry = (typeof otlp.OtlpTelemetry)["prototype"];
}

export type { otlpTypes as default };
