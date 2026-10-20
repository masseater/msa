import type AuthUrlComponentClass from "./auth-url.ts";

declare namespace authUrlTypes {
  type AuthUrlComponent = (typeof AuthUrlComponentClass)["prototype"];
}

export type { authUrlTypes as default };
