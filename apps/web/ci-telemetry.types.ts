import type { InferEnv } from "@alchemy.run/cloudflare";

import type ciTelemetry from "./ci-telemetry.ts";

declare namespace ciTelemetryTypes {
  type Env = InferEnv<typeof ciTelemetry>;
}

export type { ciTelemetryTypes as default };
