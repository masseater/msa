import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import runtimeLazy from "../../extensions/mcp/runtime.lazy.ts";
import abortModule from "../../utils/abort.ts";
import errorsModule from "../../utils/errors.ts";
import awaitingModule from "../awaiting.ts";
import memoryModule from "./memory.ts";
import type memoryTypes from "./memory.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { loadMcpRuntime } = runtimeLazy;
const { toErrorMessage } = errorsModule;
const { raceWithAbortSignal } = abortModule;
const { SEPIACE_NAME, SEPIACE_TOOL, SIGN_IN_HINT } = memoryModule;

type Runtime = Awaited<ReturnType<typeof loadMcpRuntime>>;

const textOf = (result: mcpTypes.CallToolResult) =>
  result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

export default class SepiaceClient {
  private readonly options: memoryTypes.SepiaceClientOptions;

  private runtime: Promise<Runtime> | undefined;

  private connectionInternal: memoryTypes.McpConnection | undefined;

  private credentialsInternal: memoryTypes.CredentialStore | undefined;

  private attempt: Promise<boolean> | undefined;

  private closed = false;

  private signedOut = false;

  private storeError: string | undefined;

  constructor(options: memoryTypes.SepiaceClientOptions) {
    this.options = options;
  }

  get url(): string {
    return this.options.url;
  }

  get state(): memoryTypes.SepiaceState {
    if (this.closed) return "closed";
    if (this.storeError !== undefined) return "failed";
    if (this.signedOut) return "needs-auth";
    const state = this.connectionInternal?.state;
    if (state === undefined) return this.attempt === undefined ? "idle" : "connecting";
    if (state === "disconnected") return "idle";
    return state;
  }

  get rejected(): boolean {
    return this.state === "needs-auth" && !this.signedOut;
  }

  get error(): string | undefined {
    if (this.state !== "failed") return undefined;
    if (this.storeError !== undefined) return this.storeError;
    const reason = this.connectionInternal?.error;
    return reason === undefined ? undefined : `failed to connect: ${reason}`;
  }

  private load(): Promise<Runtime> {
    this.runtime ??= loadMcpRuntime();
    return this.runtime;
  }

  credentials(): Promise<memoryTypes.CredentialStore> {
    this.credentialsInternal ??= this.options.credentials;
    if (this.credentialsInternal !== undefined) return Promise.resolve(this.credentialsInternal);
    return this.load().then((runtime) => {
      this.credentialsInternal ??= runtime.credentialStoreFor(this.options.agentDir);
      return this.credentialsInternal;
    });
  }

  private connection(): Promise<memoryTypes.McpConnection> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const runtime = yield* awaited(this.load());
        const credentials = yield* awaited(this.credentials());
        this.connectionInternal ??= new runtime.McpServerConnection({
          createTransport: runtime.createDefaultTransport,
          credentials,
          cwd: this.options.cwd,
          entry: { config: { url: this.options.url }, name: SEPIACE_NAME, source: "memory" },
          onChange: () => this.options.onChange?.(),
          onTools: () => {},
        });
        return this.connectionInternal;
      }, this),
    );
  }

  private open(): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.storeError = undefined;
        const saved = yield* awaited(
          this.credentials()
            .then((credentials) => credentials.tokens(SEPIACE_NAME, this.options.url))
            .then(
              (tokens) => ({ tokens }),
              (error: unknown) => ({
                error: `could not read the saved sign-in: ${toErrorMessage(error)}`,
              }),
            ),
        );
        if (this.closed) return false;
        if ("error" in saved) {
          this.storeError = saved.error;
          this.options.onChange?.();
          return false;
        }
        const { tokens } = saved;
        this.signedOut = tokens === undefined;
        if (this.signedOut) {
          this.options.onChange?.();
          return false;
        }
        const connection = yield* awaited(this.connection());
        try {
          yield* awaited(connection.getClient());
          return true;
        } catch {
          return false;
        }
      }, this),
    );
  }

  connect(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (this.state === "connected") return Promise.resolve(true);
    this.attempt ??= this.open().finally(() => {
      this.attempt = undefined;
    });
    return this.attempt;
  }

  ready(signal?: AbortSignal): Promise<boolean> {
    if (this.state === "connected") return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    return raceWithAbortSignal(this.connect(), signal).catch(() => false);
  }

  call(request: string, signal: AbortSignal): Promise<memoryTypes.SepiaceReply> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (!(yield* awaited(this.ready(signal)))) throw new Error(this.notConnected());
        const connection = yield* awaited(this.connection());
        try {
          const result = yield* awaited(connection.callTool(SEPIACE_TOOL, { request }, { signal }));
          return { isError: result.isError === true, text: textOf(result) };
        } catch (error) {
          if (this.state === "needs-auth") throw new Error(this.notConnected(), { cause: error });
          throw error;
        }
      }, this),
    );
  }

  notConnected(): string {
    const state = this.state;
    if (state === "failed")
      return `sepiace is not connected: ${this.error ?? "failed to connect"}.`;
    if (state === "closed") return "sepiace is not connected: the session is closed.";
    return `sepiace is not connected; ${SIGN_IN_HINT}.`;
  }

  signIn(prompt: memoryTypes.SignInPrompt, signal: AbortSignal): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const runtime = yield* awaited(this.load());
        const connection = yield* awaited(this.connection());
        if (yield* awaited(this.connect())) return;
        if (this.state !== "needs-auth") throw new Error(this.notConnected());
        try {
          yield* awaited(
            runtime.signInMcpServer({
              challenge: connection.auth.challenge,
              prompt,
              serverUrl: this.options.url,
              settings: connection.auth.oauthSettings(),
              signal,
              store: (yield* awaited(this.credentials())).forServer(SEPIACE_NAME, this.options.url),
            }),
          );
        } catch (error) {
          if (Schema.is(runtime.McpSignInCancelledError)(error))
            throw new Error("Sign-in to sepiace was cancelled or not completed.", { cause: error });
          throw new Error(`Sign-in to sepiace failed: ${toErrorMessage(error)}`, { cause: error });
        }
        connection.auth.challenge = undefined;
        this.signedOut = false;
        try {
          yield* awaited(connection.reconnect());
        } catch (error) {
          throw new Error(`Signed in, but sepiace failed to connect: ${toErrorMessage(error)}`, {
            cause: error,
          });
        }
      }, this),
    );
  }

  signOut(): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const credentials = yield* awaited(this.credentials());
        const removed = yield* awaited(credentials.remove(SEPIACE_NAME, this.options.url));
        yield* awaited(this.connectionInternal?.signOut());
        this.signedOut = true;
        this.options.onChange?.();
        return removed;
      }, this),
    );
  }

  close(): Promise<void> {
    this.closed = true;
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.connectionInternal?.close());
        yield* awaited(this.attempt);
      }, this),
    );
  }
}
