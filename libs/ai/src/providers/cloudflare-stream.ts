import { Function } from "effect";

import type { ProviderClassifier, ProviderEnv, ProviderStreams } from "../types.ts";

const CLOUDFLARE_ACCOUNT_ID = "CLOUDFLARE_ACCOUNT_ID";
const CLOUDFLARE_GATEWAY_ID = "CLOUDFLARE_GATEWAY_ID";

export const resolveCloudflareModel: {
  <TModel extends { baseUrl: string }>(env: ProviderEnv | undefined): (model: TModel) => TModel;
  <TModel extends { baseUrl: string }>(model: TModel, env: ProviderEnv | undefined): TModel;
} = Function.dual(2, function <
  TModel extends { baseUrl: string },
>(model: TModel, env: ProviderEnv | undefined): TModel {
  if (env === undefined) return model;
  const baseUrl = model.baseUrl
    .replaceAll(
      `{${CLOUDFLARE_ACCOUNT_ID}}`,
      env[CLOUDFLARE_ACCOUNT_ID] ?? `{${CLOUDFLARE_ACCOUNT_ID}}`,
    )
    .replaceAll(
      `{${CLOUDFLARE_GATEWAY_ID}}`,
      env[CLOUDFLARE_GATEWAY_ID] ?? `{${CLOUDFLARE_GATEWAY_ID}}`,
    );
  return baseUrl === model.baseUrl ? model : { ...model, baseUrl };
});

export function cloudflareStreams(streams: ProviderStreams): ProviderStreams {
  return {
    stream: (model, context, options) =>
      streams.stream(resolveCloudflareModel(model, options?.env), context, options),
    streamSimple: (model, context, options) =>
      streams.streamSimple(resolveCloudflareModel(model, options?.env), context, options),
  };
}

export function cloudflareClassifier(classifier: ProviderClassifier): ProviderClassifier {
  return {
    classify: (model, context, options) =>
      classifier.classify(resolveCloudflareModel(model, options?.env), context, options),
  };
}
