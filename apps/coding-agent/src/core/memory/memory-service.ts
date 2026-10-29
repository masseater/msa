import * as Effect from "effect/Effect";

import interop from "../../utils/interop.ts";
import awaitingModule from "../awaiting.ts";
import platform from "../platform/index.ts";
import legacyMigration from "./legacy-migration.ts";
import memoryProject from "./memory-project.ts";
import memoryRequests from "./memory-requests.ts";
import memoryModule from "./memory.ts";
import type memoryTypes from "./memory.types.ts";
import secretCheckLazy from "./secret-check.lazy.ts";

const { awaited, awaitingWith } = awaitingModule;
const { callbackPromise } = interop;
const { exists } = platform.files;
const { migrateLegacyMemories } = legacyMigration;
const { resolveProjectName } = memoryProject;
const { MAX_REQUEST_CHARS, recallRequest } = memoryRequests;
const { SEPIACE_REQUESTS_URL, SEPIACE_URL, SIGN_IN_HINT } = memoryModule;
const { findSecrets } = secretCheckLazy;

const REQUEST_TIMEOUT_MS = 60_000;
const RECALL_TIMEOUT_MS = 5_000;
const SIGN_IN_NOT_SAVED =
  "not saved, it lasts until msa exits; set credentialHelper in mcp.json to keep it";

const describeConnection = (connection: memoryTypes.MemoryConnection) =>
  connection.state === "ready"
    ? "connected"
    : connection.state === "missing"
      ? `not connected; ${connection.detail}`
      : `the last request failed: ${connection.detail}`;

const signInProblem = (client: memoryTypes.SepiaceClient): string | undefined => {
  if (client.rejected) return `sepiace rejected the saved sign-in; ${SIGN_IN_HINT}`;
  if (client.state === "needs-auth") return `not signed in; ${SIGN_IN_HINT}`;
  return undefined;
};

const untilAborted = (signal: AbortSignal): Promise<string | undefined> =>
  callbackPromise((resolve) => {
    if (signal.aborted) resolve(undefined);
    else signal.addEventListener("abort", () => resolve(undefined), { once: true });
  });

const bounded = (signal: AbortSignal | undefined, ms: number) =>
  signal === undefined
    ? AbortSignal.timeout(ms)
    : AbortSignal.any([signal, AbortSignal.timeout(ms)]);

export default class MemoryService {
  private readonly options: memoryTypes.MemoryServiceOptions;

  private project: Promise<string> | undefined;

  private migration: Promise<memoryTypes.MigrationResult | undefined> | undefined;

  private migrationFailed = false;

  private lastFailure: string | undefined;

  constructor(options: memoryTypes.MemoryServiceOptions) {
    this.options = options;
  }

  get settings(): memoryTypes.ResolvedMemorySettings {
    return this.options.settings();
  }

  get client(): memoryTypes.SepiaceClient {
    return this.options.client;
  }

  get connected(): boolean {
    return this.options.client.state === "connected";
  }

  get signInSaved(): boolean {
    return this.options.signInSaved();
  }

  get connection(): memoryTypes.MemoryConnection {
    const { client } = this.options;
    const signIn = signInProblem(client);
    if (signIn !== undefined) return { detail: signIn, state: "missing" };
    if (this.lastFailure !== undefined) return { detail: this.lastFailure, state: "failing" };
    if (client.state === "failed")
      return { detail: client.error ?? "failed to connect", state: "missing" };
    return this.connected ? { state: "ready" } : { detail: "connecting", state: "missing" };
  }

  send(request: string, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (!this.settings.enabled) throw new Error("Memory is off (settings: memory.enabled).");
        const text = request.trim();
        if (text === "") throw new Error("The memory request is empty.");
        if (text.length > MAX_REQUEST_CHARS)
          throw new Error(`The memory request is longer than ${MAX_REQUEST_CHARS} characters.`);
        const secrets = yield* awaited(findSecrets(text));
        if (secrets.length > 0)
          throw new Error(
            `The memory request was not sent because it looks like it holds a secret (${secrets.join(", ")}). Leave secrets out of memories.`,
          );
        const outcome = yield* awaited(
          this.options.client.call(text, bounded(signal, timeoutMs)).then(
            (result) =>
              result.isError
                ? { failure: result.text === "" ? "sepiace reported an error." : result.text }
                : { reply: result.text },
            (error: unknown) => ({
              failure: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
        this.lastFailure = "failure" in outcome ? outcome.failure : undefined;
        if ("failure" in outcome) throw new Error(outcome.failure);
        return outcome.reply;
      }, this),
    );
  }

  private recallSkipped(): memoryTypes.RecallOutcome {
    const { client } = this.options;
    const problem =
      signInProblem(client) ??
      (client.state === "failed" ? (client.error ?? "failed to connect") : undefined);
    return {
      kind: "skipped",
      reason: problem ?? `sepiace did not answer within ${RECALL_TIMEOUT_MS / 1000} seconds`,
    };
  }

  recall(prompt: string, signal?: AbortSignal): Promise<memoryTypes.RecallOutcome> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const text = prompt.trim();
        if (!this.settings.recall || text === "") return { kind: "nothing" };
        if (this.options.client.state === "needs-auth") return this.recallSkipped();
        if ((yield* awaited(findSecrets(text))).length > 0) return { kind: "nothing" };
        const deadline = bounded(signal, RECALL_TIMEOUT_MS);
        if (!(yield* awaited(this.options.client.ready(deadline)))) return this.recallSkipped();
        this.project ??= resolveProjectName(this.options.cwd);
        const request = recallRequest(text, yield* awaited(this.project));
        return yield* awaited(
          this.send(request, deadline, RECALL_TIMEOUT_MS).then(
            (reply): memoryTypes.RecallOutcome =>
              reply === "" ? { kind: "nothing" } : { kind: "recalled", text: reply },
            (error: unknown): memoryTypes.RecallOutcome => ({
              kind: "skipped",
              reason: `the recall request failed: ${error instanceof Error ? error.message : String(error)}`,
            }),
          ),
        );
      }, this),
    );
  }

  legacyPending(): Promise<boolean> {
    return exists(this.options.legacyDatabase);
  }

  migrate(): Promise<memoryTypes.MigrationResult | undefined> {
    if (this.migration !== undefined) return this.migration;
    if (
      this.migrationFailed ||
      !this.settings.enabled ||
      this.options.client.state === "needs-auth"
    )
      return Promise.resolve(undefined);
    const run = this.options.client
      .ready()
      .then((ready) =>
        ready
          ? migrateLegacyMemories(this.options.agentDir, this.options.legacyDatabase, (request) =>
              this.send(request),
            )
          : undefined,
      )
      .catch((error: unknown) => {
        this.migrationFailed = true;
        throw error;
      })
      .finally(() => {
        this.migration = undefined;
      });
    this.migration = run;
    return run;
  }

  signIn(
    signal: AbortSignal,
    prompt?: Partial<memoryTypes.SignInPrompt>,
  ): Promise<string | undefined> {
    const { client } = this.options;
    return client
      .signIn(
        {
          promptForRedirectUrl: prompt?.promptForRedirectUrl ?? untilAborted,
          showAuthorizationUrl: (url) => {
            prompt?.showAuthorizationUrl?.(url);
            this.options.openUrl(url.href);
          },
        },
        signal,
      )
      .then(() => {
        this.lastFailure = undefined;
        return client.credentials();
      })
      .then((credentials) => credentials.persistenceNote());
  }

  signOut(): Promise<boolean> {
    this.lastFailure = undefined;
    return this.options.client.signOut();
  }

  status(legacyPending: boolean): string {
    const { settings } = this;
    if (!settings.enabled) return "Memory is off (settings: memory.enabled).";
    return [
      `Memory: sepiace (${describeConnection(this.connection)})`,
      ...(this.options.client.url === SEPIACE_URL ? [] : [`Endpoint: ${this.options.client.url}`]),
      ...(this.signInSaved ? [] : [`Sign-in: ${SIGN_IN_NOT_SAVED}`]),
      `Recall on every prompt: ${settings.recall ? "on" : "off"}`,
      ...(legacyPending ? ["memory.db: waiting to be moved to sepiace"] : []),
      `Requests and the memories they changed: ${SEPIACE_REQUESTS_URL}`,
    ].join("\n");
  }
}
