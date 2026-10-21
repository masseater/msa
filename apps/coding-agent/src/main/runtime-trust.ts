import projectTrustModule from "../cli/project-trust.ts";
import type agentSessionRuntimeTypes from "../core/agent-session-runtime.types.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import projectTrust from "../core/project-trust.ts";
import trustManager from "../core/trust-manager.ts";
import type mainInternalTypes from "./main-internal.types.ts";

const { createProjectTrustContext } = projectTrustModule;
const { resolveProjectTrusted } = projectTrust;
const { hasTrustRequiringProjectResources } = trustManager;

type Startup = mainInternalTypes.Startup;
type Diagnostic = agentSessionServicesTypes.AgentSessionRuntimeDiagnostic;
type FactoryArgs = Parameters<agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory>[0];

export default class RuntimeTrust {
  private readonly startup: Startup;

  private readonly projectTrustByCwd = new Map<string, boolean>();

  private readonly trustPromptMode: Startup["appMode"];

  constructor(startup: Startup) {
    this.startup = startup;
    const { parsed } = startup;
    this.trustPromptMode =
      parsed.help === true || parsed.listModels !== undefined ? "print" : startup.appMode;
  }

  trustFor(runtimeCwd: string): { projectTrusted: boolean; resolveTrust: boolean } {
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

  resolver(args: FactoryArgs, diagnostics: Diagnostic[]) {
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
}
