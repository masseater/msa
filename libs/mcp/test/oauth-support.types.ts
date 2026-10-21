import type oauthSupport from "./oauth-support.ts";

declare namespace oauthSupportTypes {
  type TestOAuthProvider = (typeof oauthSupport.TestOAuthProvider)["prototype"];
}

export type { oauthSupportTypes as default };
