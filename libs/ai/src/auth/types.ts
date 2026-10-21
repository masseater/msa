import type typesModuleModule from "../types.types.ts";

declare namespace typesModule {
  interface ModelAuth {
    apiKey?: string | undefined;
    headers?: typesModuleModule.ProviderHeaders | undefined;
    baseUrl?: string | undefined;
  }

  interface ApiKeyCredential {
    type: "api_key";
    key?: string | undefined;
    env?: typesModuleModule.ProviderEnv | undefined;
  }

  interface OAuthCredentials {
    refresh: string;
    access: string;
    expires: number;
    [key: string]: unknown;
  }

  interface OAuthCredential extends OAuthCredentials {
    type: "oauth";
  }

  type Credential = ApiKeyCredential | OAuthCredential;

  interface CredentialInfo {
    providerId: string;
    type: Credential["type"];
  }

  interface AuthOperationOptions {
    signal?: AbortSignal;
  }

  interface CredentialStore {
    read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined>;

    list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]>;

    modify(
      providerId: string,
      fn: (current: Credential | undefined) => Promise<Credential | undefined>,
      options?: AuthOperationOptions,
    ): Promise<Credential | undefined>;

    delete(providerId: string, options?: AuthOperationOptions): Promise<void>;
  }

  interface AuthContext {
    env(name: string): Promise<string | undefined>;
    fileExists(path: string): Promise<boolean>;
  }

  interface AuthResult {
    auth: ModelAuth;
    env?: typesModuleModule.ProviderEnv | undefined;
    source?: string | undefined;
  }

  interface AuthCheck {
    source?: string | undefined;
    type: "api_key" | "oauth";
  }

  type AuthType = "api_key" | "oauth";

  type AuthPrompt = { signal?: AbortSignal } & (
    | { type: "text"; message: string; placeholder?: string }
    | { type: "secret"; message: string; placeholder?: string }
    | {
        type: "select";
        message: string;
        options: readonly { id: string; label: string; description?: string }[];
      }
    | { type: "manual_code"; message: string; placeholder?: string }
  );

  interface AuthInfoLink {
    url: string;
    label?: string;
  }

  type AuthEvent =
    | { type: "info"; message: string; links?: readonly AuthInfoLink[] }
    | { type: "auth_url"; url: string; instructions?: string }
    | {
        type: "device_code";
        userCode: string;
        verificationUri: string;
        intervalSeconds?: number | undefined;
        expiresInSeconds?: number | undefined;
      }
    | { type: "progress"; message: string };

  interface AuthInteraction {
    signal?: AbortSignal;

    prompt(prompt: AuthPrompt): Promise<string>;
    notify(event: AuthEvent): void;
  }

  type ProviderAuthInteraction = AuthInteraction & { signal: AbortSignal };

  interface ApiKeyAuth {
    name: string;

    login?(interaction: ProviderAuthInteraction): Promise<ApiKeyCredential>;

    check?(input: {
      ctx: AuthContext;
      credential?: ApiKeyCredential | undefined;
      signal: AbortSignal;
    }): Promise<AuthCheck | undefined>;

    resolve(input: {
      ctx: AuthContext;
      credential?: ApiKeyCredential | undefined;
      signal: AbortSignal;
    }): Promise<AuthResult | undefined>;
  }

  interface LoginOptions {
    getDeviceId?: () => string;
    agentName?: string;
  }

  interface OAuthAuth {
    name: string;

    isSubscription?: boolean | undefined;

    loginLabel?: string | undefined;

    login(interaction: ProviderAuthInteraction, options?: LoginOptions): Promise<OAuthCredential>;

    refresh(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential>;

    toAuth(credential: OAuthCredential): Promise<ModelAuth>;
  }

  interface ProviderAuth {
    apiKey?: ApiKeyAuth;
    oauth?: OAuthAuth;
  }
}

export type { typesModule as default };
