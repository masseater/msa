import type { SettingsManager } from "./settings-manager.ts";

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isInstallTelemetryEnabled(
  settingsManager: SettingsManager,
  telemetryEnv: string | undefined = process.env["MSA_TELEMETRY"],
): boolean {
  return telemetryEnv === undefined
    ? settingsManager.getEnableInstallTelemetry()
    : isTruthyEnvFlag(telemetryEnv);
}
