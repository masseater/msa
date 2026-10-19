import { Deferred, Effect, type Fiber } from "effect";
import { type Server, serve } from "srvx";

import { foreign, type McpForeignError, toPromise } from "../foreign.ts";
import { OAuthCallbackError } from "./errors.ts";

export interface OAuthCallback {
  code: string;
  state: string;
  iss?: string;
}

export type OAuthCallbackPage = { ok: true } | { ok: false; message: string; details?: string };

export interface OAuthCallbackServerOptions {
  host?: string;
  redirectHost?: string;
  port?: number;
  path?: string;
  extraPaths?: string[];
  timeoutMs?: number;
  renderPage?: (page: OAuthCallbackPage) => string;
}

interface PendingCallback {
  deferred: Deferred.Deferred<OAuthCallback, OAuthCallbackError>;
  timer: Fiber.Fiber<void>;
  path: string | undefined;
}

function plainText(page: OAuthCallbackPage): string {
  if (page.ok) return "Authorization complete. You may close this window.";
  return page.details !== undefined && page.details !== ""
    ? `${page.message}\n\n${page.details}`
    : page.message;
}

const nonEmpty = (value: string | null): value is string => value !== null && value !== "";

const listenOn = (
  port: number,
  hostname: string,
  handle: (request: Request) => Response,
): Effect.Effect<Server, McpForeignError> =>
  Effect.tryPromise({
    try: () => {
      const server = serve({
        fetch: handle,
        port,
        hostname,
        manual: true,
        silent: true,
        gracefulShutdown: false,
      });
      return Promise.resolve(server.serve()).then(() => server);
    },
    catch: foreign,
  });

const fromServer = (close: () => Promise<void>): Effect.Effect<void, McpForeignError> =>
  Effect.tryPromise({ try: close, catch: foreign });

const boundPort = (server: Server): number | undefined => {
  const { url } = server;
  if (url === undefined) return undefined;
  const { port } = new URL(url);
  return port === "" ? undefined : Number(port);
};

export class OAuthCallbackServer {
  readonly redirectUrl: string;
  private server: Server;
  private paths: string[];
  private timeoutMs: number;
  private renderPage: ((page: OAuthCallbackPage) => string) | undefined;
  private pending = new Map<string, PendingCallback>();

  private constructor(
    server: Server,
    redirectUrl: string,
    paths: string[],
    timeoutMs: number,
    renderPage: ((page: OAuthCallbackPage) => string) | undefined,
  ) {
    this.server = server;
    this.redirectUrl = redirectUrl;
    this.paths = paths;
    this.timeoutMs = timeoutMs;
    this.renderPage = renderPage;
  }

  static listen(options: OAuthCallbackServerOptions = {}): Promise<OAuthCallbackServer> {
    return toPromise(
      Effect.gen(function* () {
        const host = options.host ?? "127.0.0.1";
        const redirectHost = options.redirectHost ?? host;
        const path = options.path ?? "/callback";
        let instance: OAuthCallbackServer | undefined;
        const server = yield* listenOn(options.port ?? 0, host, (request) =>
          instance === undefined
            ? new Response(null, { status: 503 })
            : instance.handle(new URL(request.url)),
        );
        const port = boundPort(server);
        if (port === undefined)
          return yield* new OAuthCallbackError("OAuth callback server did not bind to TCP");
        const bracketed = redirectHost.includes(":") ? `[${redirectHost}]` : redirectHost;
        instance = new OAuthCallbackServer(
          server,
          `http://${bracketed}:${port}${path}`,
          [path, ...(options.extraPaths ?? [])],
          options.timeoutMs ?? 5 * 60_000,
          options.renderPage,
        );
        return instance;
      }),
    );
  }

  waitForCallback(state: string, path?: string): Promise<OAuthCallback> {
    if (this.pending.has(state)) throw new OAuthCallbackError("OAuth state is already pending");
    const deferred = Deferred.makeUnsafe<OAuthCallback, OAuthCallbackError>();
    const timedOut = Effect.sync(() => {
      this.pending.delete(state);
      Deferred.doneUnsafe(
        deferred,
        Effect.fail(new OAuthCallbackError("OAuth callback timed out")),
      );
    });
    const timer = Effect.runFork(Effect.delay(timedOut, this.timeoutMs));
    this.pending.set(state, { deferred, timer, path });
    return toPromise(Deferred.await(deferred));
  }

  close(): Promise<void> {
    for (const pending of this.pending.values()) {
      pending.timer.interruptUnsafe();
      Deferred.doneUnsafe(
        pending.deferred,
        Effect.fail(new OAuthCallbackError("OAuth callback server closed")),
      );
    }
    this.pending.clear();
    return toPromise(fromServer(() => this.server.close()));
  }

  private reply(status: number, page: OAuthCallbackPage): Response {
    if (this.renderPage === undefined) {
      return new Response(plainText(page), {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(this.renderPage(page), {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  private settle(pending: PendingCallback, outcome: OAuthCallback | OAuthCallbackError): void {
    Deferred.doneUnsafe(
      pending.deferred,
      outcome instanceof OAuthCallbackError ? Effect.fail(outcome) : Effect.succeed(outcome),
    );
  }

  private handle(url: URL): Response {
    if (!this.paths.includes(url.pathname)) {
      return this.reply(404, { ok: false, message: "Not found" });
    }
    const state = url.searchParams.get("state");
    const pending = nonEmpty(state) ? this.pending.get(state) : undefined;
    if (!nonEmpty(state) || pending === undefined) {
      return this.reply(400, { ok: false, message: "Invalid or expired OAuth state" });
    }
    pending.timer.interruptUnsafe();
    this.pending.delete(state);
    return this.complete(url, state, pending);
  }

  private complete(url: URL, state: string, pending: PendingCallback): Response {
    if (pending.path !== undefined && url.pathname !== pending.path) {
      this.settle(
        pending,
        new OAuthCallbackError("The authorization response arrived on another redirect URI"),
      );
      return this.reply(400, { ok: false, message: "Unexpected redirect URI" });
    }
    const error = url.searchParams.get("error");
    if (nonEmpty(error)) {
      const description = url.searchParams.get("error_description") ?? error;
      this.settle(pending, new OAuthCallbackError(description));
      return this.reply(200, {
        ok: false,
        message: "Authorization failed. You may close this window.",
        details: description,
      });
    }
    const code = url.searchParams.get("code");
    if (!nonEmpty(code)) {
      this.settle(
        pending,
        new OAuthCallbackError("OAuth callback did not include an authorization code"),
      );
      return this.reply(400, { ok: false, message: "Missing authorization code" });
    }
    const iss = url.searchParams.get("iss");
    this.settle(pending, { code, state, ...(nonEmpty(iss) ? { iss } : {}) });
    return this.reply(200, { ok: true });
  }
}
