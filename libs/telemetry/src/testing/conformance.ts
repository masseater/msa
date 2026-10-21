import lifecycleCasesModule from "./lifecycle-cases.ts";
import passivityCasesModule from "./passivity-cases.ts";
import recordingCasesModule from "./recording-cases.ts";
import signalCasesModule from "./signal-cases.ts";
import support from "./support.ts";
import type typesModule from "./types.ts";

const { lifecycleCases } = lifecycleCasesModule;
const { recordingCases } = recordingCasesModule;
const { passivityCases } = passivityCasesModule;
const { signalCases } = signalCasesModule;
const { createCase } = support;

function createTelemetryAdapterConformance(
  factory: typesModule.TelemetryAdapterFixtureFactory,
): readonly typesModule.TelemetryAdapterConformanceCase[] {
  return [...lifecycleCases, ...recordingCases, ...passivityCases, ...signalCases].map(
    (definition) => createCase(factory, definition),
  );
}

const conformance = {
  createTelemetryAdapterConformance,
};

export default conformance;
