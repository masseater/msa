import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import runnerEvents from "../../src/core/extensions/runner-events.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import agentSessionMcpOauthSupport from "./agent-session-mcp-oauth-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { emitSessionShutdownEvent } = runnerEvents;

const { callWhoami } = agentSessionMcpOauthSupport;

const { getMessageText } = harnessModule;

const { currentTimeMillis } = testing;

const { runCleanups, setup } = agentSessionMcpOauthHarness;

const signsInThroughTheBrowserRefreshes = Effect.gen(function* () {
  const { harness, server, notifications, backend } = yield* Effect.promise(() => setup("follow"));

  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp"));

  expect(notifications).toContain(
    "MCP servers need attention:\n  issues: needs sign-in\nRun /mcp to fix.",
  );
  expect(notifications.at(-1)).toBe("issues: needs sign-in, run /mcp login issues (direct)");

  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(server.log).toEqual(["401 none", "register", "token code"]);
  expect(backend.withLock((current) => ({ result: current }))).toContain(
    '"access_token": "access-1"',
  );

  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-1");

  server.expireAccessTokens();
  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-2");
  expect(server.log.slice(-3)).toEqual(["401 access-1", "token refresh", "call access-2"]);

  backend.withLock((current) => {
    const states = JSON.parse(current ?? "{}") as Record<string, { tokensExpireAt?: number }>;
    for (const state of Object.values(states)) state.tokensExpireAt = currentTimeMillis() - 1_000;
    return { next: JSON.stringify(states), result: undefined };
  });
  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-3");
  expect(server.log.slice(-2)).toEqual(["token refresh", "call access-3"]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp logout issues"));
  expect(notifications.at(-1)).toBe('Signed out of MCP server "issues".');
  const result = yield* Effect.promise(() => callWhoami(harness));
  expect(result.isError).toBe(true);
  expect(getMessageText(result)).toBe('MCP server "issues" requires sign-in. Run /mcp to sign in.');
});

const acceptsAPastedRedirectUrlWhen = Effect.gen(function* () {
  const { harness, server, notifications } = yield* Effect.promise(() => setup("paste"));

  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp login"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe(`token access-1`);
  expect(server.log).toContain("token code");
});

function shutdown(harness: harnessTypes.Harness): Promise<number> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const start = currentTimeMillis();
      yield* Effect.promise(() =>
        emitSessionShutdownEvent(harness.session.extensions.binding.extensionRunner, {
          reason: "quit",
          type: "session_shutdown",
        }),
      );
      return currentTimeMillis() - start;
    }),
  );
}

for (const path of ["/.well-known/oauth-authorization-server", "/token"]) {
  it(`cancels a sign-in waiting on ${path} when the session shuts down`, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { harness, server, notifications } = yield* Effect.promise(() => setup("follow"));
        server.stall.add(path);
        const login = harness.session.run.prompting.prompt("/mcp login issues");
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(server.stalled).toHaveLength(1), { timeout: 5_000 }),
        );

        expect(yield* Effect.promise(() => shutdown(harness))).toBeLessThan(2_000);
        yield* Effect.promise(() => login);

        expect(server.stalled).toHaveLength(1);
        expect(notifications.filter((message) => message.startsWith("Sign-in"))).toEqual([]);
      }),
    ));
}

const closesTheSessionWithoutRefreshingAn = Effect.gen(function* () {
  const { harness, server, notifications, backend } = yield* Effect.promise(() => setup("follow"));
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');

  backend.withLock((current) => {
    const states = JSON.parse(current ?? "{}") as Record<string, { tokensExpireAt?: number }>;
    for (const state of Object.values(states)) state.tokensExpireAt = currentTimeMillis() + 10_000;
    return { next: JSON.stringify(states), result: undefined };
  });
  server.stall.add("/token");

  expect(yield* Effect.promise(() => shutdown(harness))).toBeLessThan(2_000);
  expect(server.stalled).toEqual([]);
  expect(server.deletes).toEqual(["access-1"]);
});

const signsInThroughTheBrowserRefreshesExpired = () =>
  Effect.runPromise(signsInThroughTheBrowserRefreshes);

const acceptsAPastedRedirectUrlWhenThe = () => Effect.runPromise(acceptsAPastedRedirectUrlWhen);

const closesTheSessionWithoutRefreshingAnExpiring = () =>
  Effect.runPromise(closesTheSessionWithoutRefreshingAn);

const afterEachHook = runCleanups;

describe("AgentSession MCP OAuth", () => {
  afterEach(afterEachHook);

  it(
    "signs in through the browser, refreshes expired tokens, and signs out",
    signsInThroughTheBrowserRefreshesExpired,
  );

  it(
    "accepts a pasted redirect URL when the browser cannot reach the callback",
    acceptsAPastedRedirectUrlWhenThe,
  );

  it(
    "closes the session without refreshing an expiring token",
    closesTheSessionWithoutRefreshingAnExpiring,
  );
});
