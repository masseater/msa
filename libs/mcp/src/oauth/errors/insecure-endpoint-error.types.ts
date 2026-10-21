import type OAuthInsecureEndpointErrorClass from "./insecure-endpoint-error.ts";

declare namespace insecureEndpointErrorTypes {
  type OAuthInsecureEndpointError = OAuthInsecureEndpointErrorClass;
}

export type { insecureEndpointErrorTypes as default };
