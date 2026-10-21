import type OAuthFlowErrorClass from "./flow-error.ts";

declare namespace flowErrorTypes {
  type OAuthFlowError = OAuthFlowErrorClass;
}

export type { flowErrorTypes as default };
