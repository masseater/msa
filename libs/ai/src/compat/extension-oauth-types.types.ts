import type typesModule from "../auth/types.ts";

declare namespace extensionOauthTypesModule {
  interface OAuthPrompt {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }

  interface OAuthAuthInfo {
    url: string;
    instructions?: string;
  }

  interface OAuthDeviceCodeInfo {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }

  interface OAuthSelectOption {
    id: string;
    label: string;
  }

  interface OAuthSelectPrompt {
    message: string;
    options: OAuthSelectOption[];
  }

  interface OAuthLoginCallbacks {
    onAuth(info: OAuthAuthInfo): void;
    onDeviceCode(info: OAuthDeviceCodeInfo): void;
    onPrompt(prompt: OAuthPrompt): Promise<string>;
    onProgress?(message: string): void;
    onManualCodeInput?(): Promise<string>;
    onSelect(prompt: OAuthSelectPrompt): Promise<string | undefined>;
    signal?: AbortSignal;
  }

  type OAuthCredentials = typesModule.OAuthCredentials;
}

export type { extensionOauthTypesModule as default };
