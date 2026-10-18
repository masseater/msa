import type { ThinkingLevel } from "@msa/agent-core";
import type { Model } from "@msa/ai";
import * as Effect from "effect/Effect";

import { getAgentDir } from "../config.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { resolvePath } from "../utils/paths.ts";
import { awaited, awaiting } from "./awaiting.ts";
import type { SessionStartEvent, ToolDefinition } from "./extensions/index.ts";
import { ModelRuntime } from "./model-runtime.ts";
import { join } from "./platform-node.ts";
import {
  DefaultResourceLoader,
  type DefaultResourceLoaderOptions,
  type ResourceLoader,
  type ResourceLoaderReloadOptions,
} from "./resource-loader.ts";
import {
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  createAgentSession,
} from "./sdk.ts";
import type { SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";

export interface AgentSessionRuntimeDiagnostic {
  type: "info" | "warning" | "error";
  message: string;
}

export interface CreateAgentSessionServicesOptions {
  cwd: string;
  agentDir?: string | undefined;
  settingsManager?: SettingsManager | undefined;
  modelRuntime?: ModelRuntime | undefined;
  modelRuntimeSignal?: AbortSignal | undefined;
  extensionFlagValues?: Map<string, boolean | string> | undefined;
  resourceLoaderOptions?: Omit<
    DefaultResourceLoaderOptions,
    "cwd" | "agentDir" | "settingsManager"
  >;
  resourceLoaderReloadOptions?: ResourceLoaderReloadOptions | undefined;
}

export interface CreateAgentSessionFromServicesOptions {
  services: AgentSessionServices;
  sessionManager: SessionManager;
  sessionStartEvent?: SessionStartEvent | undefined;
  model?: Model<any> | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  scopedModels?:
    | Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel | undefined }>
    | undefined;
  tools?: string[] | undefined;
  excludeTools?: CreateAgentSessionOptions["excludeTools"] | undefined;
  noTools?: CreateAgentSessionOptions["noTools"] | undefined;
  customTools?: ToolDefinition[] | undefined;
  orchestrator?: boolean | undefined;
}

export interface AgentSessionServices {
  cwd: string;
  agentDir: string;
  modelRuntime: ModelRuntime;
  settingsManager: SettingsManager;
  resourceLoader: ResourceLoader;
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

function applyExtensionFlagValues(
  resourceLoader: ResourceLoader,
  extensionFlagValues: Map<string, boolean | string> | undefined,
): AgentSessionRuntimeDiagnostic[] {
  if (extensionFlagValues === undefined) {
    return [];
  }

  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  const extensionsResult = resourceLoader.getExtensions();
  const registeredFlags = new Map<string, { type: "boolean" | "string" }>();
  for (const extension of extensionsResult.extensions) {
    for (const [name, flag] of extension.flags) {
      registeredFlags.set(name, { type: flag.type });
    }
  }

  const unknownFlags: string[] = [];
  for (const [name, value] of extensionFlagValues) {
    const flag = registeredFlags.get(name);
    if (flag === undefined) {
      unknownFlags.push(name);
      continue;
    }
    if (flag.type === "boolean") {
      extensionsResult.runtime.flagValues.set(name, true);
      continue;
    }
    if (typeof value === "string") {
      extensionsResult.runtime.flagValues.set(name, value);
      continue;
    }
    diagnostics.push({
      type: "error",
      message: `Extension flag "--${name}" requires a value`,
    });
  }

  if (unknownFlags.length > 0) {
    diagnostics.push({
      type: "error",
      message: `Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map((name) => `--${name}`).join(", ")}`,
    });
  }

  return diagnostics;
}

export function createAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
): Promise<AgentSessionServices> {
  return Effect.runPromise(
    awaiting(function* () {
      const cwd = resolvePath(options.cwd);
      const agentDir =
        options.agentDir !== undefined && options.agentDir !== ""
          ? resolvePath(options.agentDir)
          : getAgentDir();
      const modelRuntime =
        options.modelRuntime ??
        (yield* awaited(
          ModelRuntime.create({
            authPath: join(agentDir, "auth.json"),
            modelsPath: join(agentDir, "models.json"),
            signal: options.modelRuntimeSignal,
          }),
        ));
      const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
      const resourceLoader = new DefaultResourceLoader({
        ...(options.resourceLoaderOptions ?? {}),
        cwd,
        agentDir,
        settingsManager,
      });
      yield* awaited(resourceLoader.reload(options.resourceLoaderReloadOptions));

      const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
      const extensionsResult = resourceLoader.getExtensions();
      for (const { name, config, extensionPath } of extensionsResult.runtime
        .pendingProviderRegistrations) {
        try {
          modelRuntime.registerProvider(name, config);
        } catch (error) {
          const message = toErrorMessage(error);
          diagnostics.push({
            type: "error",
            message: `Extension "${extensionPath}" error: ${message}`,
          });
        }
      }
      extensionsResult.runtime.pendingProviderRegistrations = [];
      for (const { provider, extensionPath } of extensionsResult.runtime
        .pendingNativeProviderRegistrations) {
        try {
          modelRuntime.registerNativeProvider(provider);
        } catch (error) {
          const message = toErrorMessage(error);
          diagnostics.push({
            type: "error",
            message: `Extension "${extensionPath}" error: ${message}`,
          });
        }
      }
      extensionsResult.runtime.pendingNativeProviderRegistrations = [];
      for (const { definition, extensionPath } of extensionsResult.runtime
        .pendingVirtualModelRegistrations) {
        try {
          modelRuntime.registerVirtualModel(definition);
        } catch (error) {
          const message = toErrorMessage(error);
          diagnostics.push({
            type: "error",
            message: `Extension "${extensionPath}" error: ${message}`,
          });
        }
      }
      extensionsResult.runtime.pendingVirtualModelRegistrations = [];
      yield* awaited(modelRuntime.refresh({ allowNetwork: false }));
      diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));

      return {
        cwd,
        agentDir,
        modelRuntime,
        settingsManager,
        resourceLoader,
        diagnostics,
      };
    }),
  );
}

export function createAgentSessionFromServices(
  options: CreateAgentSessionFromServicesOptions,
): Promise<CreateAgentSessionResult> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        createAgentSession({
          cwd: options.services.cwd,
          agentDir: options.services.agentDir,
          modelRuntime: options.services.modelRuntime,
          settingsManager: options.services.settingsManager,
          resourceLoader: options.services.resourceLoader,
          sessionManager: options.sessionManager,
          model: options.model,
          thinkingLevel: options.thinkingLevel,
          scopedModels: options.scopedModels,
          tools: options.tools,
          excludeTools: options.excludeTools,
          noTools: options.noTools,
          customTools: options.customTools,
          sessionStartEvent: options.sessionStartEvent,
          orchestrator: options.orchestrator,
        }),
      );
    }),
  );
}
