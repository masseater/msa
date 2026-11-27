import platformEnv from "./platform/env.ts";
import platform from "./platform/index.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { isTruthyEnvFlag } = platformEnv;

const { readEnv } = platform;

function isInstallTelemetryEnabled(
  settingsManager: settingsManagerTypes.SettingsManager,
  telemetryEnv: string | undefined = readEnv("MSA_TELEMETRY"),
): boolean {
  return telemetryEnv === undefined
    ? settingsManager.telemetry.getEnableInstallTelemetry()
    : isTruthyEnvFlag(telemetryEnv);
}

const telemetry = {
  isInstallTelemetryEnabled,
};

export default telemetry;
