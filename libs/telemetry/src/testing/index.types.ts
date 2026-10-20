import type typesModule from "./types.ts";

declare namespace testingTypes {
  type TelemetryAdapterConformanceCase = typesModule.TelemetryAdapterConformanceCase;

  type TelemetryAdapterFixture = typesModule.TelemetryAdapterFixture;

  type TelemetryAdapterFixtureFactory = typesModule.TelemetryAdapterFixtureFactory;
}

export type { testingTypes as default };
