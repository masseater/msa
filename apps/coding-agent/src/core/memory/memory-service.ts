import type agentTypes from "@msa/agent-core/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import platform from "../platform/index.ts";
import legacyMigration from "./legacy-migration.ts";
import memoryProject from "./memory-project.ts";
import memoryRequests from "./memory-requests.ts";
import memoryModule from "./memory.ts";
import type memoryTypes from "./memory.types.ts";
import secretCheckLazy from "./secret-check.lazy.ts";

const { awaited, awaitingWith } = awaitingModule;
const { randomHex } = platform;
const { exists } = platform.files;
const { migrateLegacyMemories } = legacyMigration;
const { resolveProjectName } = memoryProject;
const { MAX_REQUEST_CHARS, recallRequest } = memoryRequests;
const { SEPIACE_REQUESTS_URL, SEPIACE_SERVER_NAME } = memoryModule;
const { findSecrets } = secretCheckLazy;

const REQUEST_TIMEOUT_MS = 60_000;
const RECALL_TIMEOUT_MS = 5_000;

const describeConnection = (connection: memoryTypes.MemoryConnection) =>
  connection.state === "ready"
    ? "connected"
    : connection.state === "missing"
      ? `not connected; ${connection.detail}`
      : `the last request failed: ${connection.detail}`;

const bounded = (signal: AbortSignal | undefined, ms: number) =>
  signal === undefined
    ? AbortSignal.timeout(ms)
    : AbortSignal.any([signal, AbortSignal.timeout(ms)]);

const textOf = (result: agentTypes.AgentToolResult<unknown>) =>
  result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

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

  get connected(): boolean {
    return this.options.tool() !== undefined;
  }

  get connection(): memoryTypes.MemoryConnection {
    if (!this.connected)
      return {
        detail: `sign in with /mcp login ${SEPIACE_SERVER_NAME}, or check /mcp`,
        state: "missing",
      };
    return this.lastFailure === undefined
      ? { state: "ready" }
      : { detail: this.lastFailure, state: "failing" };
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
        const tool = this.options.tool();
        if (tool === undefined)
          throw new Error(
            `sepiace is not connected. Sign in with /mcp login ${SEPIACE_SERVER_NAME}, or check /mcp.`,
          );
        const outcome = yield* awaited(
          tool
            .execute(`memory-${randomHex(8)}`, { request: text }, bounded(signal, timeoutMs))
            .then(
              (result) => {
                const reply = textOf(result);
                return result.isError === true
                  ? { failure: reply === "" ? "sepiace reported an error." : reply }
                  : { reply };
              },
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

  recall(prompt: string, signal?: AbortSignal): Promise<string | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const text = prompt.trim();
        if (!this.settings.recall || text === "" || !this.connected) return undefined;
        if ((yield* awaited(findSecrets(text))).length > 0) return undefined;
        this.project ??= resolveProjectName(this.options.cwd);
        const request = recallRequest(text, yield* awaited(this.project));
        const reply = yield* awaited(this.send(request, signal, RECALL_TIMEOUT_MS).catch(() => ""));
        return reply === "" ? undefined : reply;
      }, this),
    );
  }

  legacyPending(): Promise<boolean> {
    return exists(this.options.legacyDatabase);
  }

  migrate(): Promise<memoryTypes.MigrationResult | undefined> {
    if (this.migration !== undefined) return this.migration;
    if (this.migrationFailed || !this.settings.enabled || !this.connected)
      return Promise.resolve(undefined);
    const run = migrateLegacyMemories(
      this.options.agentDir,
      this.options.legacyDatabase,
      (request) => this.send(request),
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

  status(legacyPending: boolean): string {
    const { settings } = this;
    if (!settings.enabled) return "Memory is off (settings: memory.enabled).";
    return [
      `Memory: sepiace (${describeConnection(this.connection)})`,
      `Recall on every prompt: ${settings.recall ? "on" : "off"}`,
      ...(legacyPending ? ["memory.db: waiting to be moved to sepiace"] : []),
      `Requests and the memories they changed: ${SEPIACE_REQUESTS_URL}`,
    ].join("\n");
  }
}
