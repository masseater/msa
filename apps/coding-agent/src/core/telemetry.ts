import platform from "./platform/index.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { readEnv } = platform;

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

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
