import { lifecycleCases } from "./lifecycle-cases.ts";
import { passivityCases } from "./passivity-cases.ts";
import { recordingCases } from "./recording-cases.ts";
import { createCase } from "./support.ts";
import type { TelemetryAdapterConformanceCase, TelemetryAdapterFixtureFactory } from "./types.ts";

export function createTelemetryAdapterConformance(
  factory: TelemetryAdapterFixtureFactory,
): readonly TelemetryAdapterConformanceCase[] {
  return [...lifecycleCases, ...recordingCases, ...passivityCases].map((definition) =>
    createCase(factory, definition),
  );
}
