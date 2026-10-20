import { Effect } from "effect";

import type typesModule from "../types.ts";

const importOAuthModule = (specifier: string): Promise<unknown> => {
  const runtimeSpecifier = import.meta.url.endsWith(".js")
    ? specifier.replace(/\.ts$/u, ".js")
    : specifier;
  return import(runtimeSpecifier);
};

type OAuthFlowLoaders = {
  openaiCodex: () => typesModule.OAuthAuth | Promise<typesModule.OAuthAuth>;
  openaiChatGPT: () => typesModule.OAuthAuth | Promise<typesModule.OAuthAuth>;
  openrouter: () => typesModule.OAuthAuth | Promise<typesModule.OAuthAuth>;
};

let bundledLoaders: OAuthFlowLoaders | undefined;

const registerBundledOAuthFlowLoaders = (loaders: OAuthFlowLoaders): void => {
  bundledLoaders = loaders;
};

interface OAuthModuleSource {
  readonly bundled: (
    loaders: OAuthFlowLoaders,
  ) => typesModule.OAuthAuth | Promise<typesModule.OAuthAuth>;
  readonly specifier: string;
  readonly fromModule: (module: unknown) => typesModule.OAuthAuth;
}

const loadOAuth = (source: OAuthModuleSource): Promise<typesModule.OAuthAuth> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const loaders = bundledLoaders;
      if (loaders !== undefined)
        return yield* Effect.promise(() => Promise.resolve(source.bundled(loaders)));
      return source.fromModule(yield* Effect.promise(() => importOAuthModule(source.specifier)));
    }),
  );

const loadOpenAICodexOAuth = (): Promise<typesModule.OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.openaiCodex(),
    fromModule: (module) =>
      (module as { readonly default: { readonly openaiCodexOAuth: typesModule.OAuthAuth } }).default
        .openaiCodexOAuth,
    specifier: "./openai-codex.ts",
  });

const loadOpenAIChatGPTOAuth = (): Promise<typesModule.OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.openaiChatGPT(),
    fromModule: (module) =>
      (module as { readonly default: { readonly openaiChatGPTOAuth: typesModule.OAuthAuth } })
        .default.openaiChatGPTOAuth,
    specifier: "./openai-chatgpt.ts",
  });

const loadOpenRouterOAuth = (): Promise<typesModule.OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.openrouter(),
    fromModule: (module) =>
      (module as { readonly default: { readonly openRouterOAuth: typesModule.OAuthAuth } }).default
        .openRouterOAuth,
    specifier: "./openrouter.ts",
  });

const load = {
  loadOpenAIChatGPTOAuth,
  loadOpenAICodexOAuth,
  loadOpenRouterOAuth,
  registerBundledOAuthFlowLoaders,
};

export default load;
