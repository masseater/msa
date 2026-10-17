import { Deferred, Effect, Fiber } from "effect";
import { expect, it } from "vite-plus/test";

import { callbackUrl, defectOf, expectDefect, request, send, start } from "./oauth-callback.ts";

it("ignores stray requests", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* start();
        expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/u);
        expect((yield* request(new URL("/other", server.redirectUri))).status).toBe(404);
        const wrongState = yield* request(
          callbackUrl(server.redirectUri, { code: "c", state: "other" }),
        );
        expect(wrongState).toMatchObject({ status: 400, contentType: "text/html; charset=utf-8" });
        expect(wrongState.body).toContain("State mismatch.");
        const post = yield* send({
          url: callbackUrl(server.redirectUri, { code: "c", state: "expected-state" }),
          method: "POST",
        });
        expect(post.status).toBe(404);
        const missingCode = yield* request(
          callbackUrl(server.redirectUri, { state: "expected-state" }),
        );
        expect(missingCode.status).toBe(400);
      }),
    ),
  ));

it("resolves with the completed code", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* start();
        const success = yield* request(
          callbackUrl(server.redirectUri, { code: "the-code", state: "expected-state" }),
        );
        expect(success).toMatchObject({ status: 200, contentType: "text/html; charset=utf-8" });
        expect(success.body).toContain("Authentication successful");
        expect(success.body).toContain("Signed in to Example.");
        expect(success.body).toContain('fill="#F09082"');
        expect(success.body).toContain('fill="#4D9ABF"');
        expect(success.body).toContain('fill="#F1BE58"');
        expect(yield* server.wait).toBe("completed:the-code");
      }),
    ),
  ));

it("uses the redirect host and skips the state check when none is expected", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* start({ redirectHost: "localhost", state: undefined });
        expect(server.redirectUri).toMatch(/^http:\/\/localhost:\d+\/callback$/u);
        const response = yield* request(callbackUrl(server.redirectUri, { code: "no-state" }));
        expect(response.status).toBe(200);
        expect(yield* server.wait).toBe("completed:no-state");
      }),
    ),
  ));

it("shows completion failures on the page and rejects the wait", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* start({
          complete: () => Effect.die(new Error("token exchange failed")),
        });
        const failure = yield* request(
          callbackUrl(server.redirectUri, { code: "c", state: "expected-state" }),
        );
        expect(failure.status).toBe(502);
        expect(failure.body).toContain("Example sign-in failed.");
        expect(failure.body).toContain("token exchange failed");
        yield* expectDefect(server.wait, "token exchange failed");
      }),
    ),
  ));

it("rejects the wait when the provider redirects with an error", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* start();
        const failure = yield* request(
          callbackUrl(server.redirectUri, {
            error: "access_denied",
            error_description: "User denied access",
            state: "expected-state",
          }),
        );
        expect(failure.status).toBe(400);
        expect(failure.body).toContain("User denied access");
        yield* expectDefect(server.wait, "Example authorization failed: User denied access");
      }),
    ),
  ));

it("completes only the first callback", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const exchange = yield* Deferred.make<string>();
        const server = yield* start({
          complete: () =>
            Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(exchange)),
        });
        const url = callbackUrl(server.redirectUri, { code: "c", state: "expected-state" });
        const first = yield* Effect.forkChild(request(url));
        yield* Deferred.await(started);
        expect((yield* request(url)).status).toBe(409);
        yield* server.cancel;
        yield* Deferred.succeed(exchange, "done");
        expect((yield* Fiber.join(first)).status).toBe(200);
        expect(yield* server.wait).toBe("done");
      }),
    ),
  ));

it("resolves with undefined after cancel", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* start();
        yield* server.cancel;
        expect(yield* server.wait).toBeUndefined();
        const late = yield* request(
          callbackUrl(server.redirectUri, { code: "c", state: "expected-state" }),
        );
        expect(late.status).toBe(409);
      }),
    ),
  ));

it("rejects the wait on abort and on timeout", () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const aborted = yield* start({ signal: controller.signal });
        controller.abort();
        yield* expectDefect(aborted.wait, "Login cancelled");

        const timedOut = yield* start({ timeoutMs: 10 });
        yield* expectDefect(timedOut.wait, "Example sign-in timed out");

        yield* expectDefect(start({ signal: AbortSignal.abort() }), "Login cancelled");
      }),
    ),
  );
});

it("fails instead of picking another port when the requested port is taken", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const blocker = yield* start();
        const port = Number(new URL(blocker.redirectUri).port);
        expect(yield* defectOf(start({ port }))).toMatchObject({ code: "EADDRINUSE" });
      }),
    ),
  ));
