import type foreignTypes from "../foreign.types.ts";
import type errorsTypes from "./errors.types.ts";
import type flowTypesModule from "./flow-types.ts";

declare namespace tokenTypes {
  type TokenRequestError =
    | foreignTypes.McpForeignError
    | errorsTypes.OAuthError
    | errorsTypes.OAuthFlowError
    | errorsTypes.OAuthInsecureEndpointError;

  interface AuthorizationCodeExchange extends flowTypesModule.TokenRequestOptions {
    code: string;
    codeVerifier: string;
    redirectUrl: string | URL;
  }

  interface RefreshRequest extends flowTypesModule.TokenRequestOptions {
    refreshToken: string;
  }
}

export type { tokenTypes as default };
