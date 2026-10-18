import { type AddressInfo, createServer } from "node:net";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type { ToolResultMessage } from "@msa/ai/compat";
import { currentTimeMillis, joinPath, toJsonText } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { InMemoryAuthStorageBackend } from "../../src/core/auth-storage.ts";
import { emitSessionShutdownEvent } from "../../src/core/extensions/runner.ts";
import { runMcpCommand } from "../../src/extensions/mcp/cli.ts";
import type { McpOAuthConfig, McpServerEntry } from "../../src/extensions/mcp/config.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { McpOAuthCredentialStore } from "../../src/extensions/mcp/oauth.ts";
import { createHarness, createTestUiContext, getMessageText, type Harness } from "./harness.ts";
import { startOAuthMcpServer } from "./mcp-oauth-server.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const cleanups: (() => Promise<void> | void)[] = [];

function setup(browser: "follow" | "paste", oauth?: McpOAuthConfig) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* Effect.promise(() => startOAuthMcpServer());
      cleanups.push(server.close);
      const backend = new InMemoryAuthStorageBackend();
      const entry: McpServerEntry = {
        name: "issues",
        config: {
          url: server.url,
          exposure: "direct",
          ...(oauth === undefined ? {} : { oauth }),
        },
        source: "test",
      };
      const notifications: string[] = [];
      const opened: URL[] = [];
      let redirectLocation: Promise<string> | undefined;
      const harness: Harness = yield* Effect.promise(() =>
        createHarness({
          initialActiveToolNames: [],
          extensionFactories: [
            createMcpExtension({
              loadConfig: () => ({ servers: [entry], errors: [] }),
              credentials: new McpOAuthCredentialStore(backend),
              openUrl: (url) => {
                opened.push(new URL(url));
                if (browser === "follow") {
                  void fetch(url);
                } else {
                  redirectLocation = fetch(url, { redirect: "manual" }).then(
                    (response) => response.headers.get("location") ?? "",
                  );
                }
              },
            }),
          ],
        }),
      );
      cleanups.push(() => harness.cleanup());
      yield* Effect.promise(() =>
        harness.session.bindExtensions({
          uiContext: createTestUiContext({
            notify: (message) => notifications.push(message),

            input: (_title, _placeholder, opts) =>
              browser === "paste"
                ? Promise.resolve(redirectLocation)
                : new Promise((resolve) =>
                    opts?.signal?.addEventListener("abort", () => resolve(undefined), {
                      once: true,
                    }),
                  ),
          }),
        }),
      );
      return { harness, server, notifications, backend, opened };
    }),
  );
}

function callWhoami(harness: Harness): Promise<ToolResultMessage> {
  return Effect.runPromise(
    Effect.gen(function* () {
      harness.setResponses([
        fauxAssistantMessage([fauxToolCall("mcp__issues__whoami", {})], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]);
      const before = harness.session.messages.length;
      yield* Effect.promise(() => harness.session.prompt("who am i"));
      const result = harness.session.messages
        .slice(before)
        .find((message): message is ToolResultMessage => message.role === "toolResult");
      if (result === undefined) throw new Error("no tool result");
      return result;
    }),
  );
}

const signsInThroughTheBrowserRefreshes = Effect.gen(function* () {
  const { harness, server, notifications, backend } = yield* Effect.promise(() => setup("follow"));

  yield* Effect.promise(() => harness.session.prompt("/mcp"));

  expect(notifications).toContain(
    "MCP servers need attention:\n  issues: needs sign-in\nRun /mcp to fix.",
  );
  expect(notifications.at(-1)).toBe("issues: needs sign-in, run /mcp login issues (direct)");

  yield* Effect.promise(() => harness.session.prompt("/mcp login issues"));
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
    return { result: undefined, next: JSON.stringify(states) };
  });
  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-3");
  expect(server.log.slice(-2)).toEqual(["token refresh", "call access-3"]);

  yield* Effect.promise(() => harness.session.prompt("/mcp logout issues"));
  expect(notifications.at(-1)).toBe('Signed out of MCP server "issues".');
  const result = yield* Effect.promise(() => callWhoami(harness));
  expect(result.isError).toBe(true);
  expect(getMessageText(result)).toBe('MCP server "issues" requires sign-in. Run /mcp to sign in.');
});

const acceptsAPastedRedirectUrlWhen = Effect.gen(function* () {
  const { harness, server, notifications } = yield* Effect.promise(() => setup("paste"));

  yield* Effect.promise(() => harness.session.prompt("/mcp login"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe(`token access-1`);
  expect(server.log).toContain("token code");
});

function shutdown(harness: Harness): Promise<number> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const start = currentTimeMillis();
      yield* Effect.promise(() =>
        emitSessionShutdownEvent(harness.session.extensionRunner, {
          type: "session_shutdown",
          reason: "quit",
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
        const login = harness.session.prompt("/mcp login issues");
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(server.stalled).toHaveLength(1), { timeout: 5_000 }),
        );

        expect(yield* Effect.promise(() => shutdown(harness))).toBeLessThan(2_000);
        yield* Effect.promise(() => login);

        yield* Effect.promise(() =>
          vi.waitFor(() => expect(server.stalled[0]?.request.socket.destroyed).toBe(true)),
        );
        expect(notifications.filter((message) => message.startsWith("Sign-in"))).toEqual([]);
      }),
    ));
}

const closesTheSessionWithoutRefreshingAn = Effect.gen(function* () {
  const { harness, server, notifications, backend } = yield* Effect.promise(() => setup("follow"));
  yield* Effect.promise(() => harness.session.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');

  backend.withLock((current) => {
    const states = JSON.parse(current ?? "{}") as Record<string, { tokensExpireAt?: number }>;
    for (const state of Object.values(states)) state.tokensExpireAt = currentTimeMillis() + 10_000;
    return { result: undefined, next: JSON.stringify(states) };
  });
  server.stall.add("/token");

  expect(yield* Effect.promise(() => shutdown(harness))).toBeLessThan(2_000);
  expect(server.stalled).toEqual([]);
  expect(server.deletes).toEqual(["access-1"]);
});

function freePort(): Promise<number> {
  return Effect.runPromise(
    Effect.promise(() => {
      return new Promise<number>((resolve) => {
        const probe = createServer().listen(0, "127.0.0.1", () => {
          const address = probe.address() as AddressInfo;
          probe.close(() => resolve(address.port));
        });
      });
    }),
  );
}

const usesTheConfiguredCallbackUrlAnd = Effect.gen(function* () {
  const callbackUrl = `http://localhost:${yield* Effect.promise(() => freePort())}/callback`;
  const { harness, notifications, opened } = yield* Effect.promise(() =>
    setup("follow", {
      callbackUrl,
      scope: "issues:read",
    }),
  );

  yield* Effect.promise(() => harness.session.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(opened[0]?.searchParams.get("redirect_uri")).toBe(callbackUrl);
  expect(opened[0]?.searchParams.get("scope")).toBe("issues:read");
  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-1");
});

const registersWithTheConfiguredClientName = Effect.gen(function* () {
  const { harness, server, notifications } = yield* Effect.promise(() =>
    setup("follow", { clientName: "Claude Code" }),
  );
  yield* Effect.promise(() => harness.session.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(server.registrations.map((metadata) => metadata["client_name"])).toEqual(["Claude Code"]);

  const fallback = yield* Effect.promise(() => setup("follow"));
  yield* Effect.promise(() => fallback.harness.session.prompt("/mcp login issues"));
  expect(fallback.server.registrations.map((metadata) => metadata["client_name"])).toEqual(["msa"]);

  expect(fallback.server.registrations.map((metadata) => metadata["application_type"])).toEqual([
    "native",
  ]);
});

const addsTheListeningPortToA = Effect.gen(function* () {
  const { harness, notifications, opened } = yield* Effect.promise(() =>
    setup("follow", {
      callbackUrl: "http://127.0.0.1/oauth/done",
    }),
  );
  yield* Effect.promise(() => harness.session.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(opened[0]?.searchParams.get("redirect_uri")).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+\/oauth\/done$/u,
  );

  const port = yield* Effect.promise(() => freePort());
  const fixed = yield* Effect.promise(() =>
    setup("follow", {
      callbackUrl: "http://127.0.0.1/oauth/done",
      callbackPort: port,
    }),
  );
  yield* Effect.promise(() => fixed.harness.session.prompt("/mcp login issues"));
  expect(fixed.opened[0]?.searchParams.get("redirect_uri")).toBe(
    `http://127.0.0.1:${port}/oauth/done`,
  );
});

const givesUpOnMsaMcpLogin = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const server = yield* Effect.promise(() => startOAuthMcpServer());
  cleanups.push(server.close);
  const agentDir = yield* fs.makeTempDirectory({ prefix: "msa-mcp-login-" });
  cleanups.push(() => runtime.runPromise(fs.remove(agentDir, { recursive: true, force: true })));
  yield* fs.writeFileString(
    joinPath(agentDir, "mcp.json"),
    yield* toJsonText({ mcpServers: { issues: { url: server.url } } }),
  );
  const login = () =>
    runPromise(
      Effect.gen(function* () {
        const output: string[] = [];
        const exitCode = yield* Effect.promise(() =>
          runMcpCommand(["login", "issues", "--timeout", "0.5"], {
            cwd: agentDir,
            agentDir,
            credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),

            openUrl: () => {},
            log: (line) => output.push(line),
            error: (line) => output.push(line),
          }),
        );
        return { exitCode, output };
      }),
    );

  const unapproved = yield* Effect.promise(() => login());
  expect(unapproved.exitCode).toBe(1);
  expect(unapproved.output.at(-1)).toContain("was cancelled or not completed within");

  server.stall.add("/.well-known/oauth-authorization-server");
  const stalled = yield* Effect.promise(() => login());
  expect(stalled.exitCode).toBe(1);
  expect(stalled.output.at(-1)).toContain("was cancelled or not completed within");
});

const usesCredentialsFromMsaMcpLogin = Effect.gen(function* () {
  const { harness, server, backend } = yield* Effect.promise(() => setup("follow"));
  const agentDir = yield* fs.makeTempDirectory({ prefix: "msa-mcp-login-" });
  cleanups.push(() => runtime.runPromise(fs.remove(agentDir, { recursive: true, force: true })));
  yield* fs.writeFileString(
    joinPath(agentDir, "mcp.json"),
    yield* toJsonText({ mcpServers: { issues: { url: server.url } } }),
  );

  const output: string[] = [];
  const exitCode = yield* Effect.promise(() =>
    runMcpCommand(["login", "issues"], {
      cwd: agentDir,
      agentDir,
      credentials: new McpOAuthCredentialStore(backend),
      openUrl: (url) => void fetch(url),
      log: (line) => output.push(line),
      error: (line) => output.push(line),
    }),
  );
  expect(exitCode).toBe(0);
  expect(output.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');

  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-1");
});

describe("AgentSession MCP OAuth", () => {
  afterEach(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        while (cleanups.length > 0)
          yield* Effect.promise(() => Promise.resolve(cleanups.pop()?.()));
      }),
    ),
  );
  it("signs in through the browser, refreshes expired tokens, and signs out", () =>
    Effect.runPromise(signsInThroughTheBrowserRefreshes));
  it("accepts a pasted redirect URL when the browser cannot reach the callback", () =>
    Effect.runPromise(acceptsAPastedRedirectUrlWhen));
  it("closes the session without refreshing an expiring token", () =>
    Effect.runPromise(closesTheSessionWithoutRefreshingAn));
  it("uses the configured callback URL and scope", () =>
    Effect.runPromise(usesTheConfiguredCallbackUrlAnd));
  it("registers with the configured client name", () =>
    Effect.runPromise(registersWithTheConfiguredClientName));
  it("adds the listening port to a callback URL without one", () =>
    Effect.runPromise(addsTheListeningPortToA));
  it("gives up on msa mcp login after --timeout, also while the authorization server hangs", () =>
    Effect.runPromise(givesUpOnMsaMcpLogin));
  it("uses credentials from msa mcp login on the next turn", () =>
    Effect.runPromise(usesCredentialsFromMsaMcpLogin));
});
