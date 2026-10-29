import { Deferred, Effect, type Fiber, Schema } from "effect";
import { type Server, serve } from "srvx";

import foreignModule from "../foreign.ts";
import type foreignTypes from "../foreign.types.ts";
import type callbackTypes from "./callback.types.ts";
import errors from "./errors.ts";
import type errorsTypes from "./errors.types.ts";

const { foreign, toPromise } = foreignModule;
const { OAuthCallbackError } = errors;

interface PendingCallback {
  deferred: Deferred.Deferred<callbackTypes.OAuthCallback, errorsTypes.OAuthCallbackError>;
  timer: Fiber.Fiber<void>;
  path: string | undefined;
}

function plainText(page: callbackTypes.OAuthCallbackPage): string {
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
): Effect.Effect<Server, foreignTypes.McpForeignError> =>
  Effect.tryPromise({
    catch: foreign,
    try: () => {
      const server = serve({
        fetch: handle,
        gracefulShutdown: false,
        hostname,
        manual: true,
        port,
        silent: true,
      });
      return Promise.resolve(server.serve()).then(() => server);
    },
  });

const fromServer = (
  close: () => Promise<void>,
): Effect.Effect<void, foreignTypes.McpForeignError> =>
  Effect.tryPromise({ catch: foreign, try: close });

const boundPort = (server: Server): number | undefined => {
  const { url } = server;
  if (url === undefined) return undefined;
  const { port } = new URL(url);
  return port === "" ? undefined : Number(port);
};

export default class OAuthCallbackServer {
  readonly redirectUrl: string;
  private server: Server;
  private paths: string[];
  private timeoutMs: number;
  private replyPage: callbackTypes.OAuthCallbackServerOptions["replyPage"];
  private pending = new Map<string, PendingCallback>();

  private constructor(
    server: Server,
    redirectUrl: string,
    paths: string[],
    timeoutMs: number,
    replyPage: callbackTypes.OAuthCallbackServerOptions["replyPage"],
  ) {
    this.server = server;
    this.redirectUrl = redirectUrl;
    this.paths = paths;
    this.timeoutMs = timeoutMs;
    this.replyPage = replyPage;
  }

  static listen(
    options: callbackTypes.OAuthCallbackServerOptions = {},
  ): Promise<OAuthCallbackServer> {
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
          return yield* OAuthCallbackError.create("OAuth callback server did not bind to TCP");
        const bracketed = redirectHost.includes(":") ? `[${redirectHost}]` : redirectHost;
        instance = new OAuthCallbackServer(
          server,
          `http://${bracketed}:${port}${path}`,
          [path, ...(options.extraPaths ?? [])],
          options.timeoutMs ?? 5 * 60_000,
          options.replyPage,
        );
        return instance;
      }),
    );
  }

  waitForCallback(state: string, path?: string): Promise<callbackTypes.OAuthCallback> {
    if (this.pending.has(state)) throw OAuthCallbackError.create("OAuth state is already pending");
    const deferred = Deferred.makeUnsafe<
      callbackTypes.OAuthCallback,
      errorsTypes.OAuthCallbackError
    >();
    const timedOut = Effect.sync(() => {
      this.pending.delete(state);
      Deferred.doneUnsafe(
        deferred,
        Effect.fail(OAuthCallbackError.create("OAuth callback timed out")),
      );
    });
    const timer = Effect.runFork(Effect.delay(timedOut, this.timeoutMs));
    this.pending.set(state, { deferred, path, timer });
    return toPromise(Deferred.await(deferred));
  }

  close(): Promise<void> {
    for (const pending of this.pending.values()) {
      pending.timer.interruptUnsafe();
      Deferred.doneUnsafe(
        pending.deferred,
        Effect.fail(OAuthCallbackError.create("OAuth callback server closed")),
      );
    }
    this.pending.clear();
    return toPromise(fromServer(() => this.server.close()));
  }

  private reply(status: number, page: callbackTypes.OAuthCallbackPage): Response {
    if (this.replyPage === undefined) {
      return new Response(plainText(page), {
        headers: { "content-type": "text/plain; charset=utf-8" },
        status,
      });
    }
    const reply = this.replyPage(status, page);
    return new Response(reply.body, { headers: reply.headers, status: reply.status });
  }

  private settle(
    pending: PendingCallback,
    outcome: callbackTypes.OAuthCallback | errorsTypes.OAuthCallbackError,
  ): void {
    Deferred.doneUnsafe(
      pending.deferred,
      Schema.is(OAuthCallbackError)(outcome) ? Effect.fail(outcome) : Effect.succeed(outcome),
    );
  }

  private handle(url: URL): Response {
    if (!this.paths.includes(url.pathname)) {
      return this.reply(404, { message: "Not found", ok: false });
    }
    const state = url.searchParams.get("state");
    const pending = nonEmpty(state) ? this.pending.get(state) : undefined;
    if (!nonEmpty(state) || pending === undefined) {
      return this.reply(400, { message: "Invalid or expired OAuth state", ok: false });
    }
    pending.timer.interruptUnsafe();
    this.pending.delete(state);
    return this.complete(url, state, pending);
  }

  private complete(url: URL, state: string, pending: PendingCallback): Response {
    if (pending.path !== undefined && url.pathname !== pending.path) {
      this.settle(
        pending,
        OAuthCallbackError.create("The authorization response arrived on another redirect URI"),
      );
      return this.reply(400, { message: "Unexpected redirect URI", ok: false });
    }
    const error = url.searchParams.get("error");
    if (nonEmpty(error)) {
      const description = url.searchParams.get("error_description") ?? error;
      this.settle(pending, OAuthCallbackError.create(description));
      return this.reply(200, {
        details: description,
        message: "Authorization failed. You may close this window.",
        ok: false,
      });
    }
    const code = url.searchParams.get("code");
    if (!nonEmpty(code)) {
      this.settle(
        pending,
        OAuthCallbackError.create("OAuth callback did not include an authorization code"),
      );
      return this.reply(400, { message: "Missing authorization code", ok: false });
    }
    const iss = url.searchParams.get("iss");
    this.settle(pending, { code, state, ...(nonEmpty(iss) ? { iss } : {}) });
    return this.reply(200, { ok: true });
  }
}
