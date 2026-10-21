import type foreignTypes from "../foreign.types.ts";
import type errorsTypes from "./errors.types.ts";

declare namespace flowTypes {
  type OAuthFlowFailure =
    | foreignTypes.McpForeignError
    | errorsTypes.OAuthError
    | errorsTypes.OAuthFlowError
    | errorsTypes.OAuthInsecureEndpointError
    | errorsTypes.OAuthIssuerMismatchError
    | errorsTypes.OAuthRegistrationError;
}

export type { flowTypes as default };
