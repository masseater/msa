import { Type } from "typebox";

import settingsDefaults from "../settings-defaults.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;

const telemetryProperties = {
  deviceId: Type.Optional(
    Type.String({
      description:
        "Stable installation UUID, generated when authentication first needs it. Global only.",
    }),
  ),
  enableAnalytics: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.enableAnalytics,
      description: "Opt in to analytics data sharing.",
    }),
  ),
  enableInstallTelemetry: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.enableInstallTelemetry,
      description: "Send attribution headers to OpenRouter.",
    }),
  ),
  telemetry: Type.Optional(
    Type.Object({
      otlpEndpoint: Type.Optional(
        Type.String({
          description:
            "OTLP/HTTP base URL that receives traces, metrics, and logs, such as http://collector:4318. MSA_OTLP_ENDPOINT takes precedence. Default: the msa-grafana-lgtm podman container.",
        }),
      ),
    }),
  ),
  trackingId: Type.Optional(
    Type.String({
      description: "Analytics tracking identifier, generated when analytics is enabled.",
    }),
  ),
};

export default telemetryProperties;
