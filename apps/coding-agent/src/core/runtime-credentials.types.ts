import type RuntimeCredentialsClass from "./runtime-credentials.ts";

declare namespace runtimeCredentialsTypes {
  type RuntimeCredentials = (typeof RuntimeCredentialsClass)["prototype"];
}

export type { runtimeCredentialsTypes as default };
