import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

function collectSettingsDiagnostics(
  settingsManager: settingsManagerTypes.SettingsManager,
): agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] {
  return settingsManager.drainErrors().map(({ scope, path, error }) => ({
    message:
      path !== undefined && path !== ""
        ? `Invalid settings file ${path}: ${error.message}`
        : `Invalid ${scope} settings: ${error.message}`,
    type: "warning",
  }));
}

function deduplicateDiagnostics(
  diagnostics: readonly agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
): agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.type}\0${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const settingsDiagnostics = {
  collectSettingsDiagnostics,
  deduplicateDiagnostics,
};

export default settingsDiagnostics;
