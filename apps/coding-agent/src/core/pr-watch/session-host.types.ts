import type telemetryTypes from "@msa/telemetry/index.types";

declare namespace sessionHostTypes {
  interface PrWatchMessage {
    readonly customType: string;
    readonly content: string;
    readonly display: boolean;
  }

  interface PrWatchDelivery {
    readonly threadId: string;
    readonly sendMessage: (
      message: PrWatchMessage,
      options: { readonly triggerTurn: boolean; readonly deliverAs: "steer" },
    ) => void;
    readonly changed: () => void;
    readonly telemetry: telemetryTypes.TelemetryContext;
  }
}

export type { sessionHostTypes as default };
