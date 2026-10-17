import { createServer, type Server, type ServerResponse } from "node:http";

import { Deferred, Effect } from "effect";

import { foreign, type McpForeignError, toPromise } from "../foreign.ts";
import { schedule } from "../timer.ts";
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
  cancelTimer: () => void;
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
  server: Server,
  port: number,
  host: string,
): Effect.Effect<void, McpForeignError> =>
  Effect.callback<void, McpForeignError>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(foreign(error)));
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resume(Effect.void);
    });
  });

const closeServer = (server: Server): Effect.Effect<void, McpForeignError> =>
  Effect.callback<void, McpForeignError>((resume) => {
    server.close((error) =>
      resume(error === undefined ? Effect.void : Effect.fail(foreign(error))),
    );
  });

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
        const server = createServer((request, response) =>
          instance?.handle(request.url ?? "/", response),
        );
        yield* listenOn(server, options.port ?? 0, host);
        const address = server.address();
        if (address === null || typeof address === "string")
          return yield* new OAuthCallbackError("OAuth callback server did not bind to TCP");
        const bracketed = redirectHost.includes(":") ? `[${redirectHost}]` : redirectHost;
        instance = new OAuthCallbackServer(
          server,
          `http://${bracketed}:${address.port}${path}`,
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
    const cancelTimer = schedule(this.timeoutMs, () => {
      this.pending.delete(state);
      Deferred.doneUnsafe(
        deferred,
        Effect.fail(new OAuthCallbackError("OAuth callback timed out")),
      );
    });
    this.pending.set(state, { deferred, cancelTimer, path });
    return toPromise(Deferred.await(deferred));
  }

  close(): Promise<void> {
    for (const pending of this.pending.values()) {
      pending.cancelTimer();
      Deferred.doneUnsafe(
        pending.deferred,
        Effect.fail(new OAuthCallbackError("OAuth callback server closed")),
      );
    }
    this.pending.clear();
    return toPromise(closeServer(this.server));
  }

  private reply(response: ServerResponse, status: number, page: OAuthCallbackPage): void {
    if (this.renderPage === undefined) {
      response
        .writeHead(status, { "content-type": "text/plain; charset=utf-8" })
        .end(plainText(page));
      return;
    }
    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(this.renderPage(page));
  }

  private settle(pending: PendingCallback, outcome: OAuthCallback | OAuthCallbackError): void {
    Deferred.doneUnsafe(
      pending.deferred,
      outcome instanceof OAuthCallbackError ? Effect.fail(outcome) : Effect.succeed(outcome),
    );
  }

  private handle(rawUrl: string, response: ServerResponse): void {
    const url = new URL(rawUrl, this.redirectUrl);
    if (!this.paths.includes(url.pathname)) {
      this.reply(response, 404, { ok: false, message: "Not found" });
      return;
    }
    const state = url.searchParams.get("state");
    const pending = nonEmpty(state) ? this.pending.get(state) : undefined;
    if (!nonEmpty(state) || pending === undefined) {
      this.reply(response, 400, { ok: false, message: "Invalid or expired OAuth state" });
      return;
    }
    pending.cancelTimer();
    this.pending.delete(state);
    this.complete(url, state, pending, response);
  }

  private complete(
    url: URL,
    state: string,
    pending: PendingCallback,
    response: ServerResponse,
  ): void {
    if (pending.path !== undefined && url.pathname !== pending.path) {
      this.settle(
        pending,
        new OAuthCallbackError("The authorization response arrived on another redirect URI"),
      );
      this.reply(response, 400, { ok: false, message: "Unexpected redirect URI" });
      return;
    }
    const error = url.searchParams.get("error");
    if (nonEmpty(error)) {
      const description = url.searchParams.get("error_description") ?? error;
      this.settle(pending, new OAuthCallbackError(description));
      this.reply(response, 200, {
        ok: false,
        message: "Authorization failed. You may close this window.",
        details: description,
      });
      return;
    }
    const code = url.searchParams.get("code");
    if (!nonEmpty(code)) {
      this.settle(
        pending,
        new OAuthCallbackError("OAuth callback did not include an authorization code"),
      );
      this.reply(response, 400, { ok: false, message: "Missing authorization code" });
      return;
    }
    const iss = url.searchParams.get("iss");
    this.settle(pending, { code, state, ...(nonEmpty(iss) ? { iss } : {}) });
    this.reply(response, 200, { ok: true });
  }
}
