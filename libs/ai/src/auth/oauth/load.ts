import { Effect } from "effect";

import type { OAuthAuth } from "../types.ts";

const importOAuthModule = (specifier: string): Promise<unknown> => {
  const runtimeSpecifier = import.meta.url.endsWith(".js")
    ? specifier.replace(/\.ts$/u, ".js")
    : specifier;
  return import(runtimeSpecifier);
};

type OAuthFlowLoaders = {
  anthropic: () => OAuthAuth | Promise<OAuthAuth>;
  openaiCodex: () => OAuthAuth | Promise<OAuthAuth>;
  openaiChatGPT: () => OAuthAuth | Promise<OAuthAuth>;
  openrouter: () => OAuthAuth | Promise<OAuthAuth>;
  kimiCoding: () => OAuthAuth | Promise<OAuthAuth>;
  meta: () => OAuthAuth | Promise<OAuthAuth>;
  xai: () => OAuthAuth | Promise<OAuthAuth>;
  radius: (options: { name: string; gateway: string }) => OAuthAuth | Promise<OAuthAuth>;
};

let bundledLoaders: OAuthFlowLoaders | undefined;

export const registerBundledOAuthFlowLoaders = (loaders: OAuthFlowLoaders): void => {
  bundledLoaders = loaders;
};

interface OAuthModuleSource {
  readonly bundled: (loaders: OAuthFlowLoaders) => OAuthAuth | Promise<OAuthAuth>;
  readonly specifier: string;
  readonly fromModule: (module: unknown) => OAuthAuth;
}

const loadOAuth = (source: OAuthModuleSource): Promise<OAuthAuth> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const loaders = bundledLoaders;
      if (loaders !== undefined)
        return yield* Effect.promise(() => Promise.resolve(source.bundled(loaders)));
      return source.fromModule(yield* Effect.promise(() => importOAuthModule(source.specifier)));
    }),
  );

export const loadAnthropicOAuth = (): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.anthropic(),
    specifier: "./anthropic.ts",
    fromModule: (module) => (module as { anthropicOAuth: OAuthAuth }).anthropicOAuth,
  });

export const loadOpenAICodexOAuth = (): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.openaiCodex(),
    specifier: "./openai-codex.ts",
    fromModule: (module) => (module as { openaiCodexOAuth: OAuthAuth }).openaiCodexOAuth,
  });

export const loadOpenAIChatGPTOAuth = (): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.openaiChatGPT(),
    specifier: "./openai-chatgpt.ts",
    fromModule: (module) => (module as { openaiChatGPTOAuth: OAuthAuth }).openaiChatGPTOAuth,
  });

export const loadOpenRouterOAuth = (): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.openrouter(),
    specifier: "./openrouter.ts",
    fromModule: (module) => (module as { openRouterOAuth: OAuthAuth }).openRouterOAuth,
  });

export const loadKimiCodingOAuth = (): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.kimiCoding(),
    specifier: "./kimi-coding.ts",
    fromModule: (module) => (module as { kimiCodingOAuth: OAuthAuth }).kimiCodingOAuth,
  });

export const loadMetaOAuth = (): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.meta(),
    specifier: "./meta.ts",
    fromModule: (module) => (module as { metaOAuth: OAuthAuth }).metaOAuth,
  });

export const loadXaiOAuth = (): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.xai(),
    specifier: "./xai.ts",
    fromModule: (module) => (module as { xaiOAuth: OAuthAuth }).xaiOAuth,
  });

export const loadRadiusOAuth = (options: { name: string; gateway: string }): Promise<OAuthAuth> =>
  loadOAuth({
    bundled: (loaders) => loaders.radius(options),
    specifier: "./radius.ts",
    fromModule: (module) =>
      (
        module as {
          createRadiusOAuth: (input: { name: string; gateway: string }) => OAuthAuth;
        }
      ).createRadiusOAuth(options),
  });
