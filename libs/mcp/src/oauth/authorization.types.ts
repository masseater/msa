import type authProviderTypes from "../auth-provider.ts";
import type typesModule from "./types.types.ts";

declare namespace authorizationTypes {
  interface AuthorizationRequest {
    metadata?: typesModule.AuthorizationServerMetadata | undefined;
    clientInformation: typesModule.OAuthClientInformationMixed;
    redirectUrl: string | URL;
    scope?: string | undefined;
    state?: string | undefined;
    resource?: string | undefined;
  }

  interface ClientRegistrationRequest {
    metadata?: typesModule.AuthorizationServerMetadata | undefined;
    clientMetadata: typesModule.OAuthClientMetadata;
    scope?: string | undefined;
    fetch?: authProviderTypes.McpFetch | undefined;
    signal?: AbortSignal | undefined;
  }

  interface AuthorizationStart {
    authorizationUrl: URL;
    codeVerifier: string;
  }
}

export type { authorizationTypes as default };
