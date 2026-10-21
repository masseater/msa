import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import abortModule from "../../utils/abort.ts";
import awaitingModule from "../awaiting.ts";
import cliAgents from "../cli-agents/index.ts";
import ModelConfig from "../model-config.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import platform from "../platform/index.ts";
import type ModelAvailability from "./model-availability.ts";
import type ProviderCatalog from "./provider-catalog.ts";

const { awaited, awaiting } = awaitingModule;
const { operationSignal } = abortModule;
const { schedule } = platform;

interface RefreshTarget {
  models: aiTypes.MutableModels;
  catalog: ProviderCatalog;
  availability: ModelAvailability;
  modelsPath: string | undefined;
  modelNetworkEnabled: boolean;
}

function* refreshProvidersAvailability(
  target: RefreshTarget,
  providers: readonly string[],
  options: aiTypes.ModelsRefreshOptions,
  errors: Map<string, Error>,
) {
  yield* awaited(
    Promise.all(
      [...new Set(providers)].map((providerId) =>
        Effect.runPromise(
          target.availability.refreshProvider(providerId, operationSignal(options.signal)),
        ).catch((error: unknown) => {
          if (options.signal?.aborted !== true) {
            errors.set(providerId, error instanceof Error ? error : new Error(String(error)));
          }
        }),
      ),
    ),
  );
}

const refreshRuntime = (
  target: RefreshTarget,
  options: aiTypes.ModelsRefreshOptions,
): Promise<aiTypes.ModelsRefreshResult> =>
  Effect.runPromise(
    awaiting(function* () {
      target.catalog.config = yield* awaited(ModelConfig.load(target.modelsPath));
      yield* awaited(refreshCliAgentAccounts());
      if (options.providers === undefined) target.catalog.rebuild();
      else
        for (const providerId of new Set(options.providers)) target.catalog.recompose(providerId);
      target.availability.updateModels();
      const refreshOptions = {
        ...options,
        allowNetwork: options.allowNetwork ?? target.modelNetworkEnabled,
      };
      const result = ((yield* awaited(target.models.refresh(refreshOptions))) as
        | aiTypes.ModelsRefreshResult
        | undefined) ?? { aborted: options.signal?.aborted ?? false, errors: new Map() };
      const errors = new Map(result.errors);
      target.availability.updateModels();
      if (options.providers === undefined) {
        yield* awaited(target.availability.refreshAll(options.signal).catch(() => {}));
      } else {
        yield* refreshProvidersAvailability(target, options.providers, options, errors);
      }
      return { aborted: result.aborted || (options.signal?.aborted ?? false), errors };
    }),
  );

function refreshSignal(
  options: modelRuntimeTypes.CreateModelRuntimeOptions,
  network: boolean,
): { signal: AbortSignal | undefined; cancel?: () => void } {
  if (!network || options.modelRefreshTimeoutMs === undefined) return { signal: options.signal };
  const controller = new AbortController();
  const timeout = schedule(() => controller.abort(), options.modelRefreshTimeoutMs);
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  return { cancel: () => timeout.cancel(), signal };
}

const { refreshCliAgentAccounts } = cliAgents;

const runtimeRefresh = { refreshCliAgentAccounts, refreshRuntime, refreshSignal };

export default runtimeRefresh;
