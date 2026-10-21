import type oauthTypes from "@msa/mcp/oauth.types";

declare namespace oauthInternalTypes {
  interface CallbackSettings {
    host: string;

    redirectHost: string;
    port: number | undefined;
    path: string;

    fixedRedirectUrl: string | undefined;
  }

  type AuthorizationResponse = Pick<oauthTypes.OAuthCallback, "code" | "iss">;
}

export type { oauthInternalTypes as default };
