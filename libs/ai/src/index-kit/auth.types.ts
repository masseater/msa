import type credentialStoreTypes from "../auth/credential-store.types.ts";
import type typesModule from "../auth/types.ts";
import type extensionOauthTypesModule from "../compat/extension-oauth-types.types.ts";

declare namespace aiAuthKitTypes {
  type OAuthAuthInfo = extensionOauthTypesModule.OAuthAuthInfo;
  type OAuthDeviceCodeInfo = extensionOauthTypesModule.OAuthDeviceCodeInfo;
  type OAuthLoginCallbacks = extensionOauthTypesModule.OAuthLoginCallbacks;
  type OAuthPrompt = extensionOauthTypesModule.OAuthPrompt;
  type OAuthSelectOption = extensionOauthTypesModule.OAuthSelectOption;
  type OAuthSelectPrompt = extensionOauthTypesModule.OAuthSelectPrompt;
  type SerialTask<K, A> = credentialStoreTypes.SerialTask<K, A>;
  type ModelAuth = typesModule.ModelAuth;
  type ApiKeyCredential = typesModule.ApiKeyCredential;
  type OAuthCredentials = typesModule.OAuthCredentials;
  type OAuthCredential = typesModule.OAuthCredential;
  type Credential = typesModule.Credential;
  type CredentialInfo = typesModule.CredentialInfo;
  type AuthOperationOptions = typesModule.AuthOperationOptions;
  type CredentialStore = typesModule.CredentialStore;
  type AuthContext = typesModule.AuthContext;
  type AuthResult = typesModule.AuthResult;
  type AuthCheck = typesModule.AuthCheck;
  type AuthType = typesModule.AuthType;
  type AuthPrompt = typesModule.AuthPrompt;
  type AuthInfoLink = typesModule.AuthInfoLink;
  type AuthEvent = typesModule.AuthEvent;
  type AuthInteraction = typesModule.AuthInteraction;
  type ProviderAuthInteraction = typesModule.ProviderAuthInteraction;
  type ApiKeyAuth = typesModule.ApiKeyAuth;
  type LoginOptions = typesModule.LoginOptions;
  type OAuthAuth = typesModule.OAuthAuth;
  type ProviderAuth = typesModule.ProviderAuth;
  type InMemoryCredentialStore = credentialStoreTypes.InMemoryCredentialStore;
}

export type { aiAuthKitTypes as default };
