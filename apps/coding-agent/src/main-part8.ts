import { dual } from "effect/Function";

import type argsTypes from "./cli/args.types.ts";
import type agentSessionServicesTypes from "./core/agent-session-services.types.ts";
import type modelResolverTypes from "./core/model-resolver.types.ts";
import type sdkTypes from "./core/sdk.types.ts";
import type sessionManagerTypes from "./core/session-manager.types.ts";
import type settingsManagerTypes from "./core/settings-manager.types.ts";
import mainPart7 from "./main-part7.ts";

const { createSessionManagerImpl } = mainPart7;

const createSessionManager: {
  (
    parsed: argsTypes.Args,
    cwd: string,
    sessionDir: string | undefined,
    settingsManager: settingsManagerTypes.SettingsManager,
  ): Promise<sessionManagerTypes.SessionManager>;
  (
    cwd: string,
    sessionDir: string | undefined,
    settingsManager: settingsManagerTypes.SettingsManager,
  ): (parsed: argsTypes.Args) => Promise<sessionManagerTypes.SessionManager>;
} = dual((args: IArguments) => args.length >= 4, createSessionManagerImpl);

function buildSessionOptionsPart2(parsed: argsTypes.Args) {
  const options: sdkTypes.CreateAgentSessionOptions = {};
  const diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] = [];
  let cliThinkingFromModel = false;

  if (
    parsed.provider !== undefined &&
    parsed.provider !== "" &&
    (parsed.model === undefined || parsed.model === "")
  ) {
    diagnostics.push({
      message: `--provider requires --model (for example: --provider ${parsed.provider} --model <pattern>)`,
      type: "error",
    });
  }
  return { cliThinkingFromModel, diagnostics, options };
}

function buildSessionOptionsPart1Part1(
  parsed: argsTypes.Args,
  options: sdkTypes.CreateAgentSessionOptions,
  scopedModels: modelResolverTypes.ScopedModel[],
) {
  if (parsed.thinking !== undefined) {
    options.thinkingLevel = parsed.thinking;
  }

  if (scopedModels.length > 0) {
    options.scopedModels = scopedModels.map((sm) => ({
      model: sm.model,
      thinkingLevel: sm.thinkingLevel,
    }));
  }
}

const mainPart8 = {
  buildSessionOptionsPart1Part1,
  buildSessionOptionsPart2,
  createSessionManager,
};

export default mainPart8;
