import { msaMessagesApi } from "../api/msa-messages.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadRadiusOAuth } from "../auth/oauth/load.ts";
import type { Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import {
  DEFAULT_RADIUS_GATEWAY,
  getRadiusModels,
  getRadiusModelsFromConfig,
  loadRadiusGatewayConfig,
  normalizeRadiusGatewayUrl,
} from "./radius-config.ts";
import { RADIUS_MODELS } from "./radius.models.ts";

export interface RadiusProviderOptions {
  id?: string;
  name?: string;
  gateway?: string;
}

export function radiusProvider(options: RadiusProviderOptions = {}): Provider<"msa-messages"> {
  const id = options.id ?? "radius";
  const name = options.name ?? "Radius";
  const gateway = normalizeRadiusGatewayUrl(options.gateway ?? DEFAULT_RADIUS_GATEWAY);
  const baselineModels: Model<"msa-messages">[] =
    gateway === normalizeRadiusGatewayUrl(DEFAULT_RADIUS_GATEWAY)
      ? Object.values(RADIUS_MODELS).map((model) => Object.assign({}, model, { provider: id }))
      : [];
  let dynamicModels: Model<"msa-messages">[] | undefined;
  const streams = msaMessagesApi();

  return {
    id,
    name,
    auth: {
      apiKey: envApiKeyAuth("Radius API key", ["RADIUS_API_KEY"]),
      oauth: lazyOAuth({ name, load: () => loadRadiusOAuth({ name, gateway }) }),
    },
    getModels: () => dynamicModels ?? baselineModels,
    refreshModels: async (context) => {
      const stored = context.stored;
      if (stored !== undefined) {
        const restored = stored.models.filter(
          (model) => model.provider === id,
        ) as Model<"msa-messages">[];
        if (
          !(await context.publish({
            update: () => {
              dynamicModels = restored;
            },
          }))
        ) {
          return;
        }
      }

      if (stored === undefined && context.credential?.type === "oauth") {
        const legacy = getRadiusModels(id, context.credential);
        if (legacy.length > 0) {
          if (
            !(await context.publish({
              persist: { models: legacy, checkedAt: currentTimeMillis() },
              update: () => {
                dynamicModels = legacy;
              },
            }))
          ) {
            return;
          }
        }
      }

      if (!context.allowNetwork || context.signal.aborted) return;
      const apiKey =
        context.credential?.type === "oauth" ? context.credential.access : context.credential?.key;
      const config = await loadRadiusGatewayConfig(gateway, apiKey, context.signal);
      if (context.signal.aborted) return;
      const refreshed = getRadiusModelsFromConfig(id, config);
      await context.publish({
        persist: { models: refreshed, checkedAt: currentTimeMillis() },
        update: () => {
          dynamicModels = refreshed;
        },
      });
    },
    stream: (model, context, streamOptions) => streams.stream(model, context, streamOptions),
    streamSimple: (model, context, streamOptions) =>
      streams.streamSimple(model, context, streamOptions),
  };
}
