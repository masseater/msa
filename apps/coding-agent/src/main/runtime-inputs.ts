import type argsTypes from "../cli/args.types.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import mcpConfigNoticesModule from "../core/memory/mcp-config-notices.ts";
import runtimeModelScope from "../core/runtime-model-scope.ts";
import settingsDiagnostics from "../core/settings-diagnostics.ts";
import cliInput from "./cli-input.ts";
import type mainInternalTypes from "./main-internal.types.ts";

const { resolveModelScope } = runtimeModelScope;
const { collectSettingsDiagnostics } = settingsDiagnostics;
const { resolveCliPaths } = cliInput;
const { mcpConfigNotices } = mcpConfigNoticesModule;

type Diagnostic = agentSessionServicesTypes.AgentSessionRuntimeDiagnostic;
type Services = agentSessionServicesTypes.AgentSessionServices;

function cliResourcePaths(startup: mainInternalTypes.Startup) {
  const { cwd, parsed } = startup;
  return {
    extensions: resolveCliPaths(cwd, parsed.extensions),
    promptTemplates: resolveCliPaths(cwd, parsed.promptTemplates),
    skills: resolveCliPaths(cwd, parsed.skills),
    themes: resolveCliPaths(cwd, parsed.themes),
  };
}

function runtimeDiagnostics(
  services: Services,
  trustDiagnostics: Diagnostic[],
  location: { readonly agentDir: string; readonly cwd: string },
): Promise<Diagnostic[]> {
  const { settingsManager, resourceLoader } = services;
  const extensions = resourceLoader.getExtensions();
  return mcpConfigNotices({
    ...location,
    projectTrusted: settingsManager.isProjectTrusted(),
  }).then((memoryNotices) => [
    ...trustDiagnostics,
    ...services.diagnostics,
    ...collectSettingsDiagnostics(settingsManager),
    ...extensions.errors.map(({ path, error }) => ({
      message: `Failed to load extension "${path}": ${error}`,
      type: "error" as const,
    })),
    ...(extensions.warnings ?? []).map(({ path, warning }) => ({
      message: `Extension package "${path}": ${warning}`,
      type: "warning" as const,
    })),
    ...memoryNotices.map((message) => ({ message, type: "warning" as const })),
  ]);
}

function scopedModelsFor(parsed: argsTypes.Args, services: Services) {
  const patterns = parsed.models ?? services.settingsManager.models.getEnabledModels();
  if (patterns === undefined || patterns.length === 0) return Promise.resolve([]);
  return resolveModelScope(patterns, services.modelRuntime, {
    signal: AbortSignal.timeout(15_000),
  });
}

const runtimeInputs = { cliResourcePaths, runtimeDiagnostics, scopedModelsFor };

export default runtimeInputs;
