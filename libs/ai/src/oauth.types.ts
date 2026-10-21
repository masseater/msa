import type typesModule from "./auth/types.ts";
import type extensionOauthTypesModule from "./compat/extension-oauth-types.types.ts";

declare namespace oauthTypes {
  type OAuthAuthInfo = extensionOauthTypesModule.OAuthAuthInfo;

  type OAuthCredentials = typesModule.OAuthCredentials;

  type OAuthDeviceCodeInfo = extensionOauthTypesModule.OAuthDeviceCodeInfo;

  type OAuthLoginCallbacks = extensionOauthTypesModule.OAuthLoginCallbacks;

  type OAuthPrompt = extensionOauthTypesModule.OAuthPrompt;

  type OAuthSelectOption = extensionOauthTypesModule.OAuthSelectOption;

  type OAuthSelectPrompt = extensionOauthTypesModule.OAuthSelectPrompt;
}

export type { oauthTypes as default };
