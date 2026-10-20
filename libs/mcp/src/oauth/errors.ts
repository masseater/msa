import McpOAuthAuthorizationRequiredError from "./errors/authorization-required-error.ts";
import OAuthCallbackError from "./errors/callback-error.ts";
import OAuthFlowError from "./errors/flow-error.ts";
import OAuthInsecureEndpointError from "./errors/insecure-endpoint-error.ts";
import OAuthIssuerMismatchError from "./errors/issuer-mismatch-error.ts";
import OAuthError from "./errors/oauth-error.ts";
import OAuthRegistrationError from "./errors/registration-error.ts";

const errors = {
  McpOAuthAuthorizationRequiredError: McpOAuthAuthorizationRequiredError,
  OAuthCallbackError: OAuthCallbackError,
  OAuthError: OAuthError,
  OAuthFlowError: OAuthFlowError,
  OAuthInsecureEndpointError: OAuthInsecureEndpointError,
  OAuthIssuerMismatchError: OAuthIssuerMismatchError,
  OAuthRegistrationError: OAuthRegistrationError,
};

export default errors;
