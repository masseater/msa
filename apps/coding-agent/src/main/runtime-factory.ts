import { Effect } from "effect";

import type agentSessionRuntimeTypes from "../core/agent-session-runtime.types.ts";
import agentSessionServices from "../core/agent-session-services.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import awaitingModule from "../core/awaiting.ts";
import SettingsManager from "../core/settings-manager.ts";
import type mainInternalTypes from "./main-internal.types.ts";
import runtimeInputs from "./runtime-inputs.ts";
import runtimeSession from "./runtime-session.ts";
import RuntimeTrust from "./runtime-trust.ts";

const { createAgentSessionServices } = agentSessionServices;
const { awaited, awaitingWith } = awaitingModule;
const { cliResourcePaths, runtimeDiagnostics, scopedModelsFor } = runtimeInputs;
const { sessionFromServices } = runtimeSession;

type Startup = mainInternalTypes.Startup;
type Diagnostic = agentSessionServicesTypes.AgentSessionRuntimeDiagnostic;
type FactoryArgs = Parameters<agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory>[0];

export default class RuntimeFactory {
  private readonly startup: Startup;

  private readonly trust: RuntimeTrust;

  private readonly paths: ReturnType<typeof cliResourcePaths>;

  constructor(startup: Startup) {
    this.startup = startup;
    this.trust = new RuntimeTrust(startup);
    this.paths = cliResourcePaths(startup);
  }

  readonly create: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory = (args) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { parsed, telemetry } = this.startup;
        const trustDiagnostics: Diagnostic[] = [];
        const services = yield* awaited(this.servicesFor(args, trustDiagnostics));
        const diagnostics = yield* awaited(
          runtimeDiagnostics(services, trustDiagnostics, {
            agentDir: args.agentDir,
            cwd: args.cwd,
          }),
        );
        const scopedModels = yield* awaited(scopedModelsFor(parsed, services));
        return yield* sessionFromServices(parsed, services, scopedModels, diagnostics, {
          sessionManager: args.sessionManager,
          sessionStartEvent: args.sessionStartEvent,
          telemetry,
        });
      }, this),
    );

  private servicesFor(
    args: FactoryArgs,
    diagnostics: Diagnostic[],
  ): Promise<agentSessionServicesTypes.AgentSessionServices> {
    const { parsed, extensionFactories } = this.startup;
    return this.trust.trustFor(args.cwd).then(({ projectTrusted, resolveTrust }) =>
      SettingsManager.create(args.cwd, args.agentDir, { projectTrusted }).then((settingsManager) =>
        createAgentSessionServices({
          agentDir: args.agentDir,
          cwd: args.cwd,
          extensionFlagValues: parsed.unknownFlags,
          modelRuntimeSignal: AbortSignal.timeout(15_000),
          resourceLoaderOptions: {
            additionalExtensionPaths: this.paths.extensions,
            additionalPromptTemplatePaths: this.paths.promptTemplates,
            additionalSkillPaths: this.paths.skills,
            additionalThemePaths: this.paths.themes,
            appendSystemPrompt: parsed.appendSystemPrompt,
            disabledBuiltinExtensions: parsed.noMcp === true ? ["mcp"] : undefined,
            extensionFactories,
            noContextFiles: parsed.noContextFiles,
            noExtensions: parsed.noExtensions,
            noPromptTemplates: parsed.noPromptTemplates,
            noSkills: parsed.noSkills,
            noThemes: parsed.noThemes,
            systemPrompt: parsed.systemPrompt,
          },
          resourceLoaderReloadOptions: resolveTrust
            ? this.trust.resolver(args, diagnostics)
            : undefined,
          settingsManager,
        }),
      ),
    );
  }
}
