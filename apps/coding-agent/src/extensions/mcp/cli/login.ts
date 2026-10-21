import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import nodeReadline from "../../../core/platform/node/readline.ts";
import errorsModule from "../../../utils/errors.ts";
import interop from "../../../utils/interop.ts";
import openBrowserModule from "../../../utils/open-browser.ts";
import type cliTypes from "../cli.types.ts";
import type configTypes from "../config.types.ts";
import runtime from "../runtime.ts";
import type runtimeTypes from "../runtime.types.ts";

const { createPromiseInterface: createInterface } = nodeReadline;

const { awaited, awaiting } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { callbackPromise } = interop;
const { openBrowser } = openBrowserModule;
const { McpSignInCancelledError, signInMcpServer } = runtime;

type Line = (line: string) => void;

function waitForRedirectUrl(
  signal: AbortSignal,
  interactive: boolean,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!interactive) {
        if (!signal.aborted)
          yield* awaited(
            callbackPromise((resolve) => signal.addEventListener("abort", resolve, { once: true })),
          );
        return undefined;
      }
      const readline = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return yield* awaited(
          readline.question(
            "If the browser cannot reach this machine, paste the URL it was redirected to: ",
            { signal },
          ),
        );
      } catch {
        return undefined;
      } finally {
        readline.close();
      }
    }),
  );
}

function signIn(
  name: string,
  connection: runtimeTypes.McpServerConnection,
  url: string,
  timeoutMs: number,
  options: cliTypes.McpCommandOptions,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  log: Line,
): Promise<void> {
  const openUrl = options.openUrl ?? openBrowser;
  const interactive = process.stdin.isTTY === true && options.openUrl === undefined;
  return signInMcpServer({
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
  });
}

function login(
  entry: configTypes.McpServerEntry,
  connection: runtimeTypes.McpServerConnection,
  url: string,
  timeoutMs: number,
  options: cliTypes.McpCommandOptions,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  log: Line,
  error: Line,
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
      try {
        yield* awaited(signIn(name, connection, url, timeoutMs, options, credentials, log));
      } catch (signInError) {
        error(
          signInError instanceof McpSignInCancelledError
            ? `Sign-in to MCP server "${name}" was cancelled or not completed within ${Math.round(timeoutMs / 1000)} seconds.`
            : `Sign-in to MCP server "${name}" failed: ${toErrorMessage(signInError)}`,
        );
        return 1;
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

const loginModule = { login };

export default loginModule;
