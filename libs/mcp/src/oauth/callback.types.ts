import type OAuthCallbackServerClass from "./callback.ts";

declare namespace callbackTypes {
  interface OAuthCallback {
    code: string;
    state: string;
    iss?: string;
  }

  type OAuthCallbackPage = { ok: true } | { ok: false; message: string; details?: string };

  interface OAuthCallbackReply {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }

  interface OAuthCallbackServerOptions {
    host?: string;
    redirectHost?: string;
    port?: number;
    path?: string;
    extraPaths?: string[];
    timeoutMs?: number;
    replyPage?: (status: number, page: OAuthCallbackPage) => OAuthCallbackReply;
  }

  type OAuthCallbackServer = OAuthCallbackServerClass;
}

export type { callbackTypes as default };
