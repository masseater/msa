import adapter from "./adapter.ts";
import authorization from "./authorization.ts";
import OAuthCallbackServer from "./callback.ts";
import discovery from "./discovery.ts";
import McpOAuthAuthorizationRequiredError from "./errors/authorization-required-error.ts";
import OAuthCallbackError from "./errors/callback-error.ts";
import OAuthFlowError from "./errors/flow-error.ts";

const indexKit = {
  McpOAuthAuthorizationRequiredError,
  OAuthCallbackError,
  OAuthCallbackServer,
  OAuthFlowError,
  adapter,
  authorization,
  discovery,
};

export default indexKit;
