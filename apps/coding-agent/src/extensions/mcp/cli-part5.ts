import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import errorsModule from "../../utils/errors.ts";
import openBrowserModule from "../../utils/open-browser.ts";
import cliPart4 from "./cli-part4.ts";
import type cliTypes from "./cli.types.ts";
import type configTypes from "./config.types.ts";
import type McpOAuthCredentialStore from "./mcp-oauth-credential-store.ts";
import type McpServerConnection from "./mcp-server-connection.ts";
import runtime from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";

const { awaited, awaiting } = awaitingModule;
const { openBrowser } = openBrowserModule;
const { signInMcpServer } = runtime;
const { toErrorMessage } = errorsModule;
const { loginPart1, waitForRedirectUrl } = cliPart4;

function login(
  entry: configTypes.McpServerEntry,
  connection: runtimeTypes.McpServerConnection,
  url: string,
  timeoutMs: number,
  options: cliTypes.McpCommandOptions,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  log: (line: string) => void,
  error: (line: string) => void,
): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const { name } = entry;

      try {
        yield* awaited(connection.getClient());
        log(`Already signed in to MCP server "${name}" (${connection.tools.length} tools).`);
        return 0;
      } catch {
        if (connection.state !== "needs-auth") {
          error(`MCP server "${name}" failed to connect: ${connection.error ?? "unknown error"}`);
          return 1;
        }
      }

      const openUrl = options.openUrl ?? openBrowser;
      const interactive = process.stdin.isTTY === true && options.openUrl === undefined;
      try {
        yield* loginPart2(connection, interactive, log, name, openUrl, url, timeoutMs, credentials);
      } catch (signInError) {
        return loginPart1(error, signInError, name, timeoutMs);
      }
      connection.auth.challenge = undefined;
      try {
        yield* awaited(connection.reconnect());
      } catch (connectError) {
        error(`Signed in, but ${toErrorMessage(connectError)}`);
        return 1;
      }
      log(`Signed in to MCP server "${name}" (${connection.tools.length} tools).`);
      return 0;
    }),
  );
}

const cliPart5 = {
  login,
};

export default cliPart5;

function* loginPart2(
  connection: McpServerConnection,
  interactive: boolean,
  log: (line: string) => void,
  name: string,
  openUrl: (url: string) => void,
  url: string,
  timeoutMs: number,
  credentials: McpOAuthCredentialStore,
) {
  yield* awaited(
    signInMcpServer({
      challenge: connection.auth.challenge,
      prompt: {
        promptForRedirectUrl: (signal) => waitForRedirectUrl(signal, interactive),
        showAuthorizationUrl: (authorizationUrl) => {
          log(`Sign in to MCP server "${name}" in your browser:\n${authorizationUrl.href}`);
          openUrl(authorizationUrl.href);
        },
      },
      serverUrl: url,
      settings: connection.auth.oauthSettings(),
      signal: AbortSignal.timeout(timeoutMs),
      store: credentials.forServer(name, url),
    }),
  );
}
