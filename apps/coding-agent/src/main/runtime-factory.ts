import { Effect } from "effect";

import projectTrustModule from "../cli/project-trust.ts";
import type agentSessionRuntimeTypes from "../core/agent-session-runtime.types.ts";
import agentSessionServices from "../core/agent-session-services.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import awaitingModule from "../core/awaiting.ts";
import projectTrust from "../core/project-trust.ts";
import runtimeModelScope from "../core/runtime-model-scope.ts";
import settingsDiagnostics from "../core/settings-diagnostics.ts";
import SettingsManager from "../core/settings-manager.ts";
import trustManager from "../core/trust-manager.ts";
import cliInput from "./cli-input.ts";
import runtimeSession from "./runtime-session.ts";
import sessionOptionsModule from "./session-options.ts";
import type startupModule from "./startup.ts";

const { createProjectTrustContext } = projectTrustModule;
const { createAgentSessionServices } = agentSessionServices;
const { awaited, awaitingWith } = awaitingModule;
const { resolveProjectTrusted } = projectTrust;
const { resolveModelScope } = runtimeModelScope;
const { collectSettingsDiagnostics } = settingsDiagnostics;
const { hasTrustRequiringProjectResources } = trustManager;
const { resolveCliPaths } = cliInput;
const { createSessionFromServices } = runtimeSession;
const { buildSessionOptions } = sessionOptionsModule;

type Startup = Awaited<ReturnType<(typeof startupModule)["prepareStartup"]>>;
type Diagnostic = agentSessionServicesTypes.AgentSessionRuntimeDiagnostic;
type FactoryArgs = Parameters<agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory>[0];
type Services = agentSessionServicesTypes.AgentSessionServices;

export default class RuntimeFactory {
  private readonly startup: Startup;

  private readonly projectTrustByCwd = new Map<string, boolean>();

  private readonly trustPromptMode: Startup["appMode"];

  private readonly paths: Record<
    "extensions" | "promptTemplates" | "skills" | "themes",
    string[] | undefined
  >;

  constructor(startup: Startup) {
    this.startup = startup;
    const { cwd, parsed } = startup;
    this.trustPromptMode =
      parsed.help === true || parsed.listModels !== undefined ? "print" : startup.appMode;
    this.paths = {
      extensions: resolveCliPaths(cwd, parsed.extensions),
      promptTemplates: resolveCliPaths(cwd, parsed.promptTemplates),
      skills: resolveCliPaths(cwd, parsed.skills),
      themes: resolveCliPaths(cwd, parsed.themes),
    };
  }

  readonly create: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory = (args) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const { parsed, telemetry } = this.startup;
        const trustDiagnostics: Diagnostic[] = [];
        const services = yield* awaited(this.servicesFor(args, trustDiagnostics));
        const { settingsManager, modelRuntime } = services;
        const diagnostics = this.diagnosticsFor(services, trustDiagnostics);
        const scopedModels = yield* awaited(this.scopedModelsFor(services));
        const built = buildSessionOptions(
          parsed,
          scopedModels,
          args.sessionManager.buildSessionContext().messages.length > 0,
          modelRuntime,
          settingsManager,
        );
        return yield* createSessionFromServices(
          diagnostics,
          built.diagnostics,
          parsed,
          built.options,
          modelRuntime,
          services,
          args.sessionManager,
          args.sessionStartEvent,
          telemetry,
          built.cliThinkingFromModel,
        );
      }, this),
    );

  private trustFor(runtimeCwd: string): { projectTrusted: boolean; resolveTrust: boolean } {
    const { parsed, trustStore } = this.startup;
    const cached = this.projectTrustByCwd.get(runtimeCwd);
    const requiresTrust = hasTrustRequiringProjectResources(runtimeCwd);
    const resolveTrust =
      parsed.projectTrustOverride === undefined && cached === undefined && requiresTrust;
    const projectTrusted = resolveTrust
      ? false
      : (cached ??
        parsed.projectTrustOverride ??
        (!requiresTrust || trustStore.get(runtimeCwd) === true));
    return { projectTrusted, resolveTrust };
  }

  private trustResolver(args: FactoryArgs, diagnostics: Diagnostic[]) {
    const { appMode, parsed, startupSettingsManager, trustStore } = this.startup;
    const isInitialRuntime = args.sessionStartEvent === undefined;
    const { trustPromptMode } = this;
    return {
      resolveProjectTrust: ({
        extensionsResult,
      }: {
        extensionsResult: Parameters<typeof resolveProjectTrusted>[0]["extensionsResult"];
      }) =>
        resolveProjectTrusted({
          cwd: args.cwd,
          defaultProjectTrust: startupSettingsManager.session.getDefaultProjectTrust(),
          extensionsResult,
          onExtensionError: (message) => diagnostics.push({ message, type: "warning" }),
          projectTrustContext:
            args.projectTrustContext ??
            createProjectTrustContext({
              cwd: args.cwd,
              hasUI: isInitialRuntime && trustPromptMode === "interactive",
              mode: isInitialRuntime ? trustPromptMode : appMode,
              settingsManager: startupSettingsManager,
            }),
          trustOverride: parsed.projectTrustOverride,
          trustStore,
        }).then((trusted) => {
          this.projectTrustByCwd.set(args.cwd, trusted);
          return trusted;
        }),
    };
  }

  private servicesFor(args: FactoryArgs, diagnostics: Diagnostic[]): Promise<Services> {
    const { parsed, extensionFactories } = this.startup;
    const { projectTrusted, resolveTrust } = this.trustFor(args.cwd);
    return createAgentSessionServices({
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
      resourceLoaderReloadOptions: resolveTrust ? this.trustResolver(args, diagnostics) : undefined,
      settingsManager: SettingsManager.create(args.cwd, args.agentDir, { projectTrusted }),
    });
  }

  private diagnosticsFor(services: Services, trustDiagnostics: Diagnostic[]): Diagnostic[] {
    const { settingsManager, resourceLoader } = services;
    const extensions = resourceLoader.getExtensions();
    return [
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
    ];
  }

  private scopedModelsFor(services: Services) {
    const patterns =
      this.startup.parsed.models ?? services.settingsManager.models.getEnabledModels();
    if (patterns === undefined || patterns.length === 0) return Promise.resolve([]);
    return resolveModelScope(patterns, services.modelRuntime, {
      signal: AbortSignal.timeout(15_000),
    });
  }
}
