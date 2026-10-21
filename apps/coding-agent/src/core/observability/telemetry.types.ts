import type telemetryTypes from "@msa/telemetry/index.types";

import type TelemetryClass from "./telemetry.ts";

declare namespace telemetryTypesNs {
  type TelemetryDestination =
    | { readonly kind: "endpoint"; readonly endpoint: string; readonly source: string }
    | { readonly kind: "lgtm"; readonly podman: string }
    | { readonly kind: "off"; readonly reason: string };

  interface TelemetryInputs {
    readonly envEndpoint: string | undefined;

    readonly settingsEndpoint: string | undefined;

    readonly path: string | undefined;
    readonly version: string;
  }

  type ExportState =
    | { readonly kind: "exporting" }
    | { readonly kind: "starting" }
    | { readonly kind: "failed"; readonly reason: string };

  interface TelemetryStatus {
    readonly destination: TelemetryDestination;
    readonly state: ExportState;
  }

  interface TelemetryHandle {
    readonly context: telemetryTypes.TelemetryContext;
    status(): TelemetryStatus;
    dispose(): Promise<void>;
  }

  type Telemetry = (typeof TelemetryClass)["prototype"];
}

export type { telemetryTypesNs as default };
