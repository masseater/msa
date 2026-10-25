import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import InMemoryAuthStorageBackend from "../../src/core/in-memory-auth-storage-backend.ts";
import cli from "../../src/extensions/mcp/cli.ts";
import McpOAuthCredentialStore from "../../src/extensions/mcp/mcp-oauth-credential-store.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import agentSessionMcpOauthSupport from "./agent-session-mcp-oauth-support.ts";
import harnessModule from "./harness.ts";
import mcpOauthServer from "./mcp-oauth-server.ts";

const { runMcpCommand } = cli;
const { callWhoami, freePort } = agentSessionMcpOauthSupport;

const { startOAuthMcpServer } = mcpOauthServer;

const { getMessageText } = harnessModule;

const { joinPath, makeTempDir, removeDir, runTest, toJsonText, writeTextFile } = testing;

const { cleanups, runCleanups, setup, visitAuthorizationUrl } = agentSessionMcpOauthHarness;

const usesTheConfiguredCallbackUrlAnd = Effect.gen(function* () {
  const callbackUrl = `http://localhost:${yield* Effect.promise(() => freePort())}/callback`;
  const { harness, notifications, opened } = yield* Effect.promise(() =>
    setup("follow", {
      callbackUrl,
      scope: "issues:read",
    }),
  );

  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(opened[0]?.searchParams.get("redirect_uri")).toBe(callbackUrl);
  expect(opened[0]?.searchParams.get("scope")).toBe("issues:read");
  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-1");
});

const registersWithTheConfiguredClientName = Effect.gen(function* () {
  const { harness, server, notifications } = yield* Effect.promise(() =>
    setup("follow", { clientName: "Claude Code" }),
  );
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(server.registrations.map((metadata) => metadata["client_name"])).toEqual(["Claude Code"]);

  const fallback = yield* Effect.promise(() => setup("follow"));
  yield* Effect.promise(() => fallback.harness.session.run.prompting.prompt("/mcp login issues"));
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
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/mcp login issues"));
  expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
  expect(opened[0]?.searchParams.get("redirect_uri")).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+\/oauth\/done$/u,
  );

  const port = yield* Effect.promise(() => freePort());
  const fixed = yield* Effect.promise(() =>
    setup("follow", {
      callbackPort: port,
      callbackUrl: "http://127.0.0.1/oauth/done",
    }),
  );
  yield* Effect.promise(() => fixed.harness.session.run.prompting.prompt("/mcp login issues"));
  expect(fixed.opened[0]?.searchParams.get("redirect_uri")).toBe(
    `http://127.0.0.1:${port}/oauth/done`,
  );
});

const givesUpOnMsaMcpLogin = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const server = yield* Effect.promise(() => startOAuthMcpServer());
  cleanups.push({ cleanup: server.close });
  const agentDir = yield* makeTempDir("msa-mcp-login-");
  cleanups.push({ cleanup: () => runTest(removeDir(agentDir)) });
  yield* writeTextFile(
    joinPath(agentDir, "mcp.json"),
    yield* toJsonText({ mcpServers: { issues: { url: server.url } } }),
  );
  const login = () =>
    runPromise(
      Effect.gen(function* () {
        const output: string[] = [];
        const exitCode = yield* Effect.promise(() =>
          runMcpCommand(["login", "issues", "--timeout", "0.5"], {
            agentDir,
            credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
            cwd: agentDir,
            error: (line) => output.push(line),
            log: (line) => output.push(line),
            openUrl: () => {},
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
  const agentDir = yield* makeTempDir("msa-mcp-login-");
  cleanups.push({ cleanup: () => runTest(removeDir(agentDir)) });
  yield* writeTextFile(
    joinPath(agentDir, "mcp.json"),
    yield* toJsonText({ mcpServers: { issues: { url: server.url } } }),
  );

  const output: string[] = [];
  const exitCode = yield* Effect.promise(() =>
    runMcpCommand(["login", "issues"], {
      agentDir,
      credentials: new McpOAuthCredentialStore(backend),
      cwd: agentDir,
      error: (line) => output.push(line),
      log: (line) => output.push(line),
      openUrl: (url) => {
        void visitAuthorizationUrl(new URL(url), "follow");
      },
    }),
  );
  expect(exitCode).toBe(0);
  expect(output.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');

  expect(getMessageText(yield* Effect.promise(() => callWhoami(harness)))).toBe("token access-1");
});

const usesTheConfiguredCallbackUrlAndScope = () =>
  Effect.runPromise(usesTheConfiguredCallbackUrlAnd);

const registersWithTheConfiguredClientName2 = () =>
  Effect.runPromise(registersWithTheConfiguredClientName);

const addsTheListeningPortToACallback = () => Effect.runPromise(addsTheListeningPortToA);

const givesUpOnMsaMcpLoginAfter = () => Effect.runPromise(givesUpOnMsaMcpLogin);

const usesCredentialsFromMsaMcpLoginOn = () => Effect.runPromise(usesCredentialsFromMsaMcpLogin);

const afterEachHook = runCleanups;

describe("AgentSession MCP OAuth", () => {
  afterEach(afterEachHook);

  it("uses the configured callback URL and scope", usesTheConfiguredCallbackUrlAndScope);

  it("registers with the configured client name", registersWithTheConfiguredClientName2);

  it("adds the listening port to a callback URL without one", addsTheListeningPortToACallback);

  it(
    "gives up on msa mcp login after --timeout, also while the authorization server hangs",
    givesUpOnMsaMcpLoginAfter,
  );

  it("uses credentials from msa mcp login on the next turn", usesCredentialsFromMsaMcpLoginOn);
});
