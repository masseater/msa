import type OAuthCallbackServerClass from "./callback.ts";

declare namespace callbackTypes {
  interface OAuthCallback {
    code: string;
    state: string;
    iss?: string;
  }

  type OAuthCallbackPage = { ok: true } | { ok: false; message: string; details?: string };

  interface OAuthCallbackServerOptions {
    host?: string;
    redirectHost?: string;
    port?: number;
    path?: string;
    extraPaths?: string[];
    timeoutMs?: number;
    renderPage?: (page: OAuthCallbackPage) => string;
  }

  type OAuthCallbackServer = OAuthCallbackServerClass;
}

export type { callbackTypes as default };
