import * as Effect from "effect/Effect";

import agentSessionServiceLoader from "./agent-session-service-loader.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import awaitingModule from "./awaiting.ts";
import extensionRegistrations from "./extension-registrations.ts";
import sdk from "./sdk.ts";
import type sdkTypes from "./sdk.types.ts";

const { awaited, awaiting } = awaitingModule;
const { createAgentSession } = sdk;
const { loadAgentSessionServices } = agentSessionServiceLoader;
const { applyExtensionFlagValues, registerPendingModels, registerPendingProviders } =
  extensionRegistrations;

function createAgentSessionServices(
  options: agentSessionServicesTypes.CreateAgentSessionServicesOptions,
): Promise<agentSessionServicesTypes.AgentSessionServices> {
  return Effect.runPromise(
    awaiting(function* () {
      const services = yield* loadAgentSessionServices(options);
      const { modelRuntime, resourceLoader } = services;
      const extensionsResult = resourceLoader.getExtensions();
      const diagnostics = registerPendingProviders(modelRuntime, extensionsResult);
      diagnostics.push(...registerPendingModels(modelRuntime, extensionsResult));
      yield* awaited(modelRuntime.refresh({ allowNetwork: false }));
      diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));
      return { ...services, diagnostics };
    }),
  );
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
          inspectOnly: options.inspectOnly,
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
