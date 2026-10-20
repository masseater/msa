import * as Effect from "effect/Effect";

import configModule from "../config.ts";
import errors from "../utils/errors.ts";
import paths from "../utils/paths.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import awaitingModule from "./awaiting.ts";
import DefaultResourceLoader from "./default-resource-loader.ts";
import ModelRuntime from "./model-runtime.ts";
import platformNode from "./platform-node.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import sdk from "./sdk.ts";
import type sdkTypes from "./sdk.types.ts";
import SettingsManager from "./settings-manager.ts";

const { awaited, awaiting } = awaitingModule;
const { resolvePath } = paths;
const { getAgentDir } = configModule;
const { join } = platformNode;
const { toErrorMessage } = errors;
const { createAgentSession } = sdk;

function applyExtensionFlagValues(
  resourceLoader: resourceLoaderTypes.ResourceLoader,
  extensionFlagValues: Map<string, boolean | string> | undefined,
): agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] {
  if (extensionFlagValues === undefined) {
    return [];
  }

  const diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] = [];
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
      message: `Extension flag "--${name}" requires a value`,
      type: "error",
    });
  }

  if (unknownFlags.length > 0) {
    diagnostics.push({
      message: `Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map((name) => `--${name}`).join(", ")}`,
      type: "error",
    });
  }

  return diagnostics;
}

function createAgentSessionServices(
  options: agentSessionServicesTypes.CreateAgentSessionServicesOptions,
): Promise<agentSessionServicesTypes.AgentSessionServices> {
  return Effect.runPromise(
    awaiting(function* () {
      const cwd = resolvePath(options.cwd);
      const agentDir =
        options.agentDir !== undefined && options.agentDir !== ""
          ? resolvePath(options.agentDir)
          : getAgentDir();
      const {
        extensionsResult,
        modelRuntime,
        diagnostics,
        resourceLoader,
        settingsManager,
      }: {
        extensionsResult: import("./extensions/types-extension.ts").default.LoadExtensionsResult;
        modelRuntime: ModelRuntime;
        diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[];
        resourceLoader: DefaultResourceLoader;
        settingsManager: SettingsManager;
      } = yield* createAgentSessionServicesPart1(options, agentDir, cwd);
      for (const { provider, extensionPath } of extensionsResult.runtime
        .pendingNativeProviderRegistrations) {
        try {
          modelRuntime.registerNativeProvider(provider);
        } catch (error) {
          const message = toErrorMessage(error);
          diagnostics.push({
            message: `Extension "${extensionPath}" error: ${message}`,
            type: "error",
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
            message: `Extension "${extensionPath}" error: ${message}`,
            type: "error",
          });
        }
      }
      extensionsResult.runtime.pendingVirtualModelRegistrations = [];
      yield* awaited(modelRuntime.refresh({ allowNetwork: false }));
      diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));

      return {
        agentDir,
        cwd,
        diagnostics,
        modelRuntime,
        resourceLoader,
        settingsManager,
      };
    }),
  );
}

function* createAgentSessionServicesPart1(
  options: agentSessionServicesTypes.CreateAgentSessionServicesOptions,
  agentDir: string,
  cwd: string,
) {
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
  modelRuntime.setModelPolicy(settingsManager.models.getModelPolicy());
  const resourceLoader = new DefaultResourceLoader({
    ...(options.resourceLoaderOptions ?? {}),
    agentDir,
    cwd,
    settingsManager,
  });
  yield* awaited(resourceLoader.reload(options.resourceLoaderReloadOptions));

  const diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] = [];
  const extensionsResult = resourceLoader.getExtensions();
  for (const { name, config, extensionPath } of extensionsResult.runtime
    .pendingProviderRegistrations) {
    try {
      modelRuntime.registerProvider(name, config);
    } catch (error) {
      const message = toErrorMessage(error);
      diagnostics.push({
        message: `Extension "${extensionPath}" error: ${message}`,
        type: "error",
      });
    }
  }
  extensionsResult.runtime.pendingProviderRegistrations = [];
  return { diagnostics, extensionsResult, modelRuntime, resourceLoader, settingsManager };
}

function createAgentSessionFromServices(
  options: agentSessionServicesTypes.CreateAgentSessionFromServicesOptions,
): Promise<sdkTypes.CreateAgentSessionResult> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        createAgentSession({
          agentDir: options.services.agentDir,
          customTools: options.customTools,
          cwd: options.services.cwd,
          excludeTools: options.excludeTools,
          model: options.model,
          modelRuntime: options.services.modelRuntime,
          noTools: options.noTools,
          resourceLoader: options.services.resourceLoader,
          scopedModels: options.scopedModels,
          sessionManager: options.sessionManager,
          sessionStartEvent: options.sessionStartEvent,
          settingsManager: options.services.settingsManager,
          telemetry: options.telemetry,
          thinkingLevel: options.thinkingLevel,
          tools: options.tools,
        }),
      );
    }),
  );
}

const agentSessionServices = {
  createAgentSessionFromServices,
  createAgentSessionServices,
};

export default agentSessionServices;
