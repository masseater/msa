import testing from "@msa/testing";
import { Cause, Effect, Exit, ManagedRuntime, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

import InMemoryAuthStorageBackend from "../../src/core/in-memory-auth-storage-backend.ts";
import platform from "../../src/core/platform/index.ts";
import type configTypes from "../../src/extensions/mcp/config.types.ts";
import type oauthTypesNs from "../../src/extensions/mcp/oauth.types.ts";
import runtimeModule from "../../src/extensions/mcp/runtime.ts";
import type runtimeTypes from "../../src/extensions/mcp/runtime.types.ts";

const { McpOAuthCredentialStore, McpServerConnection, createDefaultTransport, signInMcpServer } =
  runtimeModule;
const { readEnv } = platform;
const { fromJsonText, tempRoot, toJsonText, writeTextFile } = testing;

const MAX_SIGN_INS = 3;
const REQUEST_TIMEOUT_SECONDS = 20;

class ConformanceError extends Schema.TaggedError<
  ConformanceError,
  { readonly brand: unique symbol }
>()("ConformanceError", { cause: Schema.optionalKey(Schema.Unknown), message: Schema.String }) {}

const conformanceError = (message: string, cause?: unknown): ConformanceError =>
  ConformanceError.make({ message, ...(cause === undefined ? {} : { cause }) });

const toConformanceError = (error: unknown): ConformanceError =>
  Schema.is(ConformanceError)(error) ? error : conformanceError(errorMessage(error), error);

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const log = (message: string): void => {
  process.stderr.write(`[msa-conformance] ${message}\n`);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toolCalls = (
  scenario: string,
  connection: runtimeTypes.McpServerConnection,
): ReadonlyArray<ToolCall> | undefined => {
  if (scenario.startsWith("auth/")) return [{ arguments: {}, name: "test-tool" }];
  switch (scenario) {
    case "initialize":
      return [];
    case "tools_call":
      return [{ arguments: { a: 2, b: 3 }, name: "add_numbers" }];
    case "sse-retry":
      return [{ arguments: {}, name: "test_reconnection" }];
    case "elicitation-sep1034-client-defaults":
      return [{ arguments: {}, name: "test_client_elicitation_defaults" }];
    case "json-schema-2020-12-preservation": {
      const tool = connection.tools.find(
        (candidate) => candidate.name === "json_schema_2020_12_tool",
      );
      if (tool === undefined) throw conformanceError("json_schema_2020_12_tool was not listed");
      return [{ arguments: { schema: tool.inputSchema }, name: "json_schema_echo" }];
    }
    default:
      return undefined;
  }
};

const readContext = () =>
  Effect.gen(function* () {
    const raw = readEnv("MCP_CONFORMANCE_CONTEXT");
    if (raw === undefined || raw === "") return {};
    const parsed: unknown = yield* fromJsonText(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw conformanceError("MCP_CONFORMANCE_CONTEXT is not an object");
    }
    return parsed as Record<string, unknown>;
  });

const isLoopback = (url: URL): boolean =>
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

const visitAuthorizationUrl = (url: URL) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(url).pipe(Effect.mapError(toConformanceError));
    const finalUrl = response.url;
    if (finalUrl === "")
      throw conformanceError("Authorization endpoint answered without a final URL");
    const callback = new URL(finalUrl);
    if (callback.protocol !== "http:" || !isLoopback(callback)) {
      throw conformanceError(
        `Authorization endpoint redirected to ${callback.origin}, not to the loopback callback`,
      );
    }
    log(`delivering authorization response to ${callback.origin}${callback.pathname}`);
    yield* response.text.pipe(Effect.orDie);
  });

const simulatedBrowser = (): oauthTypesNs.McpSignInPrompt => {
  let visit: Promise<void> | undefined;
  return {
    promptForRedirectUrl(signal) {
      return runtime.runPromise(
        Effect.gen(function* () {
          if (visit !== undefined) {
            const pending = visit;
            const exit = yield* Effect.exit(Effect.promise(() => pending));
            if (Exit.isFailure(exit)) {
              log(`browser failed: ${errorMessage(Cause.squash(exit.cause))}`);
              return undefined;
            }
          }
          if (!signal.aborted) {
            yield* Effect.callback<void>((resume) => {
              if (signal.aborted) {
                resume(Effect.void);
                return undefined;
              }
              const onAbort = () => resume(Effect.void);
              signal.addEventListener("abort", onAbort, { once: true });
              return Effect.sync(() => signal.removeEventListener("abort", onAbort));
            });
          }
          return undefined;
        }),
      );
    },
    showAuthorizationUrl(url) {
      log(`authorization URL: ${url.origin}${url.pathname}`);
      visit = runtime.runPromise(visitAuthorizationUrl(url));
    },
  };
};

const signIn = (
  connection: runtimeTypes.McpServerConnection,
  entry: configTypes.McpServerEntry,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  signIns: { count: number },
) =>
  Effect.gen(function* () {
    const url = connection.auth.oauthUrl;
    const scope = connection.auth.challenge?.scope;
    signIns.count += 1;
    log(
      `sign-in ${signIns.count}${scope !== undefined && scope !== "" ? ` (scope: ${scope})` : ""}`,
    );
    yield* Effect.promise(() =>
      signInMcpServer({
        serverUrl: url ?? "",
        settings: connection.auth.oauthSettings(),
        store: credentials.forServer(entry.name, url ?? ""),
        ...(connection.auth.challenge === undefined
          ? {}
          : { challenge: connection.auth.challenge }),
        prompt: simulatedBrowser(),
      }),
    );
    connection.auth.challenge = undefined;
  });

const withSignIn = <A>(
  connection: runtimeTypes.McpServerConnection,
  entry: configTypes.McpServerEntry,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  signIns: { count: number },
  operation: () => Promise<A>,
) =>
  Effect.gen(function* () {
    for (;;) {
      const exit = yield* Effect.exit(Effect.promise(operation));
      if (Exit.isSuccess(exit)) return exit.value;
      const error = Cause.squash(exit.cause);
      const url = connection.auth.oauthUrl;
      if (connection.state !== "needs-auth" || url === undefined || url === "")
        return yield* toConformanceError(error);
      if (signIns.count >= MAX_SIGN_INS)
        return yield* conformanceError(
          `Still requires sign-in after ${signIns.count} sign-ins`,
          error,
        );
      yield* signIn(connection, entry, credentials, signIns);
    }
  });

const callTools = (
  connection: runtimeTypes.McpServerConnection,
  entry: configTypes.McpServerEntry,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  signIns: { count: number },
  scenario: string,
) =>
  Effect.gen(function* () {
    yield* withSignIn(connection, entry, credentials, signIns, () => connection.getClient()).pipe(
      Effect.mapError(toConformanceError),
    );
    log(`connected, tools: ${connection.tools.map((tool) => tool.name).join(", ") || "(none)"}`);
    const calls = toolCalls(scenario, connection);
    if (calls === undefined) throw conformanceError(`Unknown scenario ${scenario}`);
    for (const call of calls) {
      const result = yield* withSignIn(connection, entry, credentials, signIns, () =>
        connection.callTool(call.name, call.arguments, {}),
      );
      const content = yield* toJsonText(result.content);
      log(`${call.name}: ${content}`);
      if (result.isError === true) throw conformanceError(`Tool ${call.name} failed: ${content}`);
    }
  });

const run = (serverUrl: string, scenario: string) =>
  Effect.gen(function* () {
    const context = yield* readContext();
    const config: configTypes.McpHttpServerConfig = {
      timeout: REQUEST_TIMEOUT_SECONDS,
      url: serverUrl,
    };
    if (typeof context["client_id"] === "string") {
      config.oauth = {
        clientId: context["client_id"],
        ...(typeof context["client_secret"] === "string"
          ? { clientSecret: context["client_secret"] }
          : {}),
      };
    }
    const entry: configTypes.McpServerEntry = {
      config,
      name: "conformance",
      source: "conformance",
    };
    const credentials = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend());
    const connection = new McpServerConnection({
      createTransport: createDefaultTransport,
      credentials,
      cwd: tempRoot(),
      entry,
      onTools: () => {},
    });
    yield* callTools(connection, entry, credentials, { count: 0 }, scenario).pipe(
      Effect.ensuring(Effect.promise(() => connection.close())),
    );
  });

const writeReport = (reportPath: string, report: Record<string, unknown>): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* writeTextFile(reportPath, `${yield* toJsonText(report)}\n`);
  });

const main = () =>
  Effect.gen(function* () {
    const serverUrl = process.argv.at(-1);
    const scenario = readEnv("MCP_CONFORMANCE_SCENARIO");
    const reportPath = readEnv("MSA_MCP_CONFORMANCE_REPORT");
    let report: { success: boolean; error?: string };
    if (
      serverUrl === undefined ||
      serverUrl === "" ||
      scenario === undefined ||
      scenario === "" ||
      process.argv.length < 3
    ) {
      report = {
        error: "Usage: MCP_CONFORMANCE_SCENARIO=<scenario> client.ts <server-url>",
        success: false,
      };
    } else {
      const exit = yield* Effect.exit(run(serverUrl, scenario));
      report = Exit.isSuccess(exit)
        ? { success: true }
        : { error: errorMessage(Cause.squash(exit.cause)), success: false };
    }
    if (report.error !== undefined && report.error !== "") log(`error: ${report.error}`);
    if (reportPath !== undefined && reportPath !== "") yield* writeReport(reportPath, report);
    return report.success ? 0 : 1;
  });

const runtime = ManagedRuntime.make(FetchHttpClient.layer);

void runtime.runPromise(main()).then((code) => process.exit(code));
