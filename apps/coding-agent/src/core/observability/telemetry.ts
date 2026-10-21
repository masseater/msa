import type telemetryTypes from "@msa/telemetry/index.types";
import { Context, Effect } from "effect";

import type telemetryTypesNs from "./telemetry.types.ts";

export default class Telemetry extends Context.Service<
  Telemetry,
  {
    readonly context: telemetryTypes.TelemetryContext;
    readonly status: Effect.Effect<telemetryTypesNs.TelemetryStatus>;
  }
>()("@msa/coding-agent/core/observability/telemetry") {}
