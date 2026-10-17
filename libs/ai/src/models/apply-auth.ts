import { Effect } from "effect";

import type { AnyModel, Api, Model, ProviderRequestOptions } from "../types.ts";
import { assertChatModel } from "../utils/model-operations.ts";
import { ModelsError } from "../utils/models-error.ts";
import { getAuth } from "./auth.ts";
import type { Provider } from "./provider-types.ts";
import { mergeHeaders, type ModelsState } from "./state.ts";
import type { ModelsRequestTransforms } from "./types.ts";

export interface ProviderLookup {
  readonly state: ModelsState;
  readonly model: AnyModel;
}

export const requireProvider = ({ state, model }: ProviderLookup): Provider => {
  const provider = state.providers.get(model.provider);
  if (provider === undefined) {
    throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
  }
  return provider;
};

export interface ChatProviderLookup {
  readonly state: ModelsState;
  readonly model: Model<Api>;
}

export const requireChatProvider = ({ state, model }: ChatProviderLookup): Provider => {
  assertChatModel(model);
  return requireProvider({ state, model });
};

export interface AuthorizedRequest<TModel extends AnyModel, TOptions> {
  readonly requestModel: TModel;
  readonly requestOptions: Omit<TOptions, "transformHeaders"> & ProviderRequestOptions<TModel>;
}

export interface ApplyAuthRequest<TModel extends AnyModel, TOptions> {
  readonly state: ModelsState;
  readonly model: TModel;
  readonly options: TOptions | undefined;
}

export const applyAuth = <
  TModel extends AnyModel,
  TOptions extends ProviderRequestOptions<TModel> & ModelsRequestTransforms,
>({
  state,
  model,
  options,
}: ApplyAuthRequest<TModel, TOptions>): Effect.Effect<AuthorizedRequest<TModel, TOptions>> =>
  Effect.gen(function* () {
    requireProvider({ state, model });
    const resolution = yield* getAuth({
      state,
      providerOrModel: model,
      overrides: { apiKey: options?.apiKey, env: options?.env, signal: options?.signal },
    });
    if (resolution === undefined) {
      return yield* Effect.die(
        new ModelsError("auth", `Provider is not configured: ${model.provider}`),
      );
    }
    const auth = resolution.auth;

    const apiKey = options?.apiKey ?? auth.apiKey;
    let headers = mergeHeaders({ base: auth.headers, override: options?.headers });
    const transformHeaders = options?.transformHeaders;
    if (transformHeaders !== undefined) {
      const current = headers ?? {};
      headers = yield* Effect.promise(() => Promise.resolve(transformHeaders(current)));
    }
    const env =
      resolution.env !== undefined || options?.env !== undefined
        ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) }
        : undefined;
    const requestModel: TModel =
      auth.baseUrl !== undefined && auth.baseUrl !== ""
        ? { ...model, baseUrl: auth.baseUrl }
        : model;
    const { transformHeaders: _transformHeaders, ...providerOptions } = options ?? {};
    const requestOptions = { ...providerOptions, apiKey, headers, env } as Omit<
      TOptions,
      "transformHeaders"
    > &
      ProviderRequestOptions<TModel>;

    return { requestModel, requestOptions };
  });
