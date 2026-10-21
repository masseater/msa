import type argsTypes from "./cli/args.types.ts";
import type agentSessionServicesTypes from "./core/agent-session-services.types.ts";
import cliModelFlag from "./core/cli-model.ts";
import type modelResolverTypes from "./core/model-resolver.types.ts";
import type modelRuntimeTypes from "./core/model-runtime.types.ts";
import type sdkTypes from "./core/sdk.types.ts";
import type settingsManagerTypes from "./core/settings-manager.types.ts";
import mainPart8 from "./main-part8.ts";
import mainPart9 from "./main-part9.ts";

const { resolveCliModel } = cliModelFlag;
const { buildSessionOptionsPart2 } = mainPart8;
const { buildSessionOptionsPart3 } = mainPart9;

function buildSessionOptions(
  parsed: argsTypes.Args,
  scopedModels: modelResolverTypes.ScopedModel[],
  hasExistingSession: boolean,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  settingsManager: settingsManagerTypes.SettingsManager,
): {
  options: sdkTypes.CreateAgentSessionOptions;
  cliThinkingFromModel: boolean;
  diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[];
} {
  let { diagnostics, options, cliThinkingFromModel }: ReturnType<typeof buildSessionOptionsPart2> =
    buildSessionOptionsPart2(parsed);
  if (parsed.model !== undefined && parsed.model !== "") {
    const resolved = resolveCliModel({
      cliModel: parsed.model,
      cliProvider: parsed.provider,
      cliThinking: parsed.thinking,
      inlineApiKey: Boolean(parsed.apiKey),
      modelRuntime,
    });
    if (resolved.warning !== undefined && resolved.warning !== "") {
      diagnostics.push({ message: resolved.warning, type: "warning" });
    }
    if (resolved.error !== undefined && resolved.error !== "") {
      diagnostics.push({ message: resolved.error, type: "error" });
    }
    if (resolved.model !== undefined) {
      options.model = resolved.model;

      if (parsed.thinking === undefined && resolved.thinkingLevel !== undefined) {
        options.thinkingLevel = resolved.thinkingLevel;
        cliThinkingFromModel = true;
      }
    }
  }

  const firstScopedModel = scopedModels[0];
  return buildSessionOptionsPart3(
    options,
    firstScopedModel,
    hasExistingSession,
    settingsManager,
    modelRuntime,
    scopedModels,
    parsed,
    cliThinkingFromModel,
    diagnostics,
  );
}

const mainPart10 = {
  buildSessionOptions,
};

export default mainPart10;
