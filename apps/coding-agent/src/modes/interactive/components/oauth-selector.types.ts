import type aiTypes from "@msa/ai/index.types";

import type OAuthSelectorComponentClass from "./oauth-selector.ts";

declare namespace oauthSelectorTypes {
  type AuthSelectorProvider = {
    id: string;
    name: string;
    authType: "oauth" | "api_key";
    method?: aiTypes.ApiKeyAuth | aiTypes.OAuthAuth | undefined;
    status?: aiTypes.AuthCheck | undefined;
    subscription?: boolean | undefined;
  };

  type OAuthSelectorComponent = (typeof OAuthSelectorComponentClass)["prototype"];
}

export type { oauthSelectorTypes as default };
