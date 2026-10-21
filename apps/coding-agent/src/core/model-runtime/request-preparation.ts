import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import requestConfig from "../provider-composer/request-config.ts";

const { mergeHeaders } = requestConfig;
const { awaited, awaiting } = awaitingModule;
const { ModelsError } = ai;

interface PreparationHost {
  readonly models: aiTypes.MutableModels;
  getAuth(
    model: aiTypes.AnyModel,
    overrides: modelRuntimeTypes.ModelRuntimeAuthOverrides,
  ): Promise<aiTypes.AuthResult | undefined>;
}

type Prepared<TModel extends aiTypes.AnyModel, TOptions> = {
  provider: aiTypes.Provider;
  model: TModel;
  options: Omit<TOptions, "transformHeaders"> & aiTypes.ProviderRequestOptions<TModel>;
};

function prepareRequest<
  TModel extends aiTypes.AnyModel,
  TOptions extends aiTypes.ProviderRequestOptions<TModel> & aiTypes.ModelsRequestTransforms,
>(
  host: PreparationHost,
  model: TModel,
  options: TOptions | undefined,
): Promise<Prepared<TModel, TOptions>> {
  return Effect.runPromise(
    awaiting(function* () {
      const provider = host.models.getProvider(model.provider);
      if (provider === undefined)
        throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
      const resolution = yield* awaited(
        host.getAuth(model, {
          apiKey: options?.apiKey,
          env: options?.env,
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        }),
      );
      if (resolution === undefined)
        throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);
      const { transformHeaders, ...rawProviderOptions } = options ?? {};
      const providerOptions = rawProviderOptions as Prepared<TModel, TOptions>["options"];
      let headers = mergeHeaders(resolution.auth.headers, providerOptions.headers);
      if (transformHeaders !== undefined) headers = yield* awaited(transformHeaders(headers ?? {}));
      const env =
        resolution.env !== undefined || providerOptions.env !== undefined
          ? { ...(resolution.env ?? {}), ...(providerOptions.env ?? {}) }
          : undefined;
      const baseUrl = resolution.auth.baseUrl;
      return {
        model: baseUrl !== undefined && baseUrl !== "" ? { ...model, baseUrl } : model,
        options: {
          ...providerOptions,
          apiKey: providerOptions.apiKey ?? resolution.auth.apiKey,
          env,
          headers,
        } as Prepared<TModel, TOptions>["options"],
        provider,
      };
    }),
  );
}

const requestPreparation = { prepareRequest };

export default requestPreparation;
