import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import runnerEvents from "../../src/core/extensions/runner-events.ts";
import SecretStoreAuthBackend from "../../src/extensions/mcp/credentials/secret-store-backend.ts";
import extension from "../../src/extensions/mcp/extension.ts";
import McpOAuthCredentialStore from "../../src/extensions/mcp/mcp-oauth-credential-store.ts";
import harnessModule from "./harness.ts";
import mcpOauthServer from "./mcp-oauth-server.ts";

const { createMcpExtension } = extension;
const { emitSessionShutdownEvent } = runnerEvents;
const { awaited, joinPath, makeDirectory, makeTempDir, removeDir, runTest, toJsonText } = testing;
const { writeTextFile } = testing;
const { createHarness } = harnessModule;
const { startOAuthMcpServer } = mcpOauthServer;

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      vi.restoreAllMocks();
      while (cleanups.length > 0) yield* awaited(cleanups.pop()?.());
    }),
  ),
);

const lockedKeychain = {
  description: "a keychain that is locked",
  persistent: true,
  read: () => Promise.reject(new Error("User interaction is not allowed.")),
  write: () => Promise.reject(new Error("User interaction is not allowed.")),
};

const agentDirWithLegacySignIn = Effect.fn("agentDirWithLegacySignIn")(function* (url: string) {
  const root = yield* makeTempDir("msa-sign-in-print-");
  cleanups.push(() => runTest(removeDir(root)));
  const agentDir = joinPath(root, "agent");
  yield* makeDirectory(agentDir);
  yield* writeTextFile(
    joinPath(agentDir, "mcp-auth.json"),
    yield* toJsonText({
      [`mcp__issues|${url}`]: {
        serverUrl: url,
        tokens: { access_token: "legacy-token", token_type: "Bearer" },
      },
    }),
  );
  return agentDir;
});

const printSession = Effect.fn("printSession")(function* (agentDir: string, url: string) {
  const backend = new SecretStoreAuthBackend({ agentDir, defaultStore: lockedKeychain });
  const harness = yield* awaited(
    createHarness({
      extensionFactories: [
        createMcpExtension({
          credentials: new McpOAuthCredentialStore(backend, agentDir),
          loadConfig: () => ({
            errors: [],
            servers: [{ config: { exposure: "direct", url }, name: "issues", source: "test" }],
          }),
        }),
      ],
      initialActiveToolNames: [],
    }),
  );
  cleanups.push(() =>
    emitSessionShutdownEvent(harness.session.extensions.binding.extensionRunner, {
      reason: "quit",
      type: "session_shutdown",
    }).then(() => {
      harness.cleanup();
      return backend.withLockAsync(() => Promise.resolve({ result: undefined }));
    }),
  );
  yield* awaited(harness.session.extensions.binding.bindExtensions({}));
});

const printsTheNoticeOnStderrWithoutAUi = () =>
  runTest(
    Effect.gen(function* () {
      const server = yield* awaited(startOAuthMcpServer());
      cleanups.push(server.close);
      const agentDir = yield* agentDirWithLegacySignIn(server.url);
      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });
      yield* printSession(agentDir, server.url);
      yield* awaited(
        vi.waitFor(() => expect(errors.join("\n")).toContain("MCP sign-ins are not saved"), {
          timeout: 5_000,
        }),
      );
      const printed = errors.join("\n");
      expect(printed).toContain("The sign-ins it held (issues) last only until");
      expect(printed).not.toContain("legacy-token");
    }),
  );

describe("MCP sign-in storage notice without a UI", () => {
  it(
    "prints the notice and the servers read from mcp-auth.json on stderr",
    printsTheNoticeOnStderrWithoutAUi,
  );
});
