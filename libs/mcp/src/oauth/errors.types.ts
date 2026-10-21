import type authorizationRequiredErrorTypes from "./errors/authorization-required-error.types.ts";
import type callbackErrorTypes from "./errors/callback-error.types.ts";
import type flowErrorTypes from "./errors/flow-error.types.ts";
import type insecureEndpointErrorTypes from "./errors/insecure-endpoint-error.types.ts";
import type issuerMismatchErrorTypes from "./errors/issuer-mismatch-error.types.ts";
import type oauthErrorTypes from "./errors/oauth-error.types.ts";
import type registrationErrorTypes from "./errors/registration-error.types.ts";

declare namespace errorsTypes {
  type McpOAuthAuthorizationRequiredError =
    authorizationRequiredErrorTypes.McpOAuthAuthorizationRequiredError;

  type OAuthCallbackError = callbackErrorTypes.OAuthCallbackError;

  type OAuthFlowError = flowErrorTypes.OAuthFlowError;

  type OAuthInsecureEndpointError = insecureEndpointErrorTypes.OAuthInsecureEndpointError;

  type OAuthIssuerMismatchError = issuerMismatchErrorTypes.OAuthIssuerMismatchError;

  type OAuthError = oauthErrorTypes.OAuthError;

  type OAuthRegistrationError = registrationErrorTypes.OAuthRegistrationError;
}

export type { errorsTypes as default };
