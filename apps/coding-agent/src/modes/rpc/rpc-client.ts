import { type ChildProcess, spawn } from "node:child_process";

import type { AgentMessage, ThinkingLevel } from "@msa/agent-core";
import type { ImageContent } from "@msa/ai";
import { Effect } from "effect";

import type {
  PromptDisposition,
  QueuedInputDisposition,
  SessionStats,
} from "../../core/agent-session.ts";
import { awaited, awaitingWith, performed } from "../../core/awaiting.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import { envSnapshot } from "../../core/process-env.ts";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.ts";
import type { JsonAgentSessionEvent } from "../json-event.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type { RpcCommand, RpcResponse, RpcSessionState, RpcSlashCommand } from "./rpc-types.ts";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

type RpcCommandBody = DistributiveOmit<RpcCommand, "id">;

export interface RpcClientOptions {
  cliPath?: string;
  cwd?: string;
  env?: Record<string, string>;
  provider?: string;
  model?: string;
  args?: string[];
}

export interface ModelInfo {
  provider: string;
  id: string;
  contextWindow: number;
  reasoning: boolean;
}

export type RpcEventListener = (event: JsonAgentSessionEvent) => void;

export class RpcClient {
  private process: ChildProcess | null = null;
  private stopReadingStdout: (() => void) | null = null;
  private eventListeners: RpcEventListener[] = [];
  private pendingRequests: Map<
    string,
    { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }
  > = new Map();
  private requestId = 0;
  private stderr = "";
  private exitError: Error | null = null;
  private options: RpcClientOptions;

  constructor(options: RpcClientOptions = {}) {
    this.options = options;
  }

  start(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.process !== null) {
          throw new Error("Client already started");
        }

        this.exitError = null;

        const cliPath = this.options.cliPath ?? "dist/cli.js";
        const args = ["--mode", "rpc"];

        if (this.options.provider !== undefined && this.options.provider !== "") {
          args.push("--provider", this.options.provider);
        }
        if (this.options.model !== undefined && this.options.model !== "") {
          args.push("--model", this.options.model);
        }
        if (this.options.args !== undefined) {
          args.push(...this.options.args);
        }

        const childProcess = spawn("node", [cliPath, ...args], {
          cwd: this.options.cwd,
          env: { ...envSnapshot(), ...this.options.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.process = childProcess;

        childProcess.stderr?.on("data", (data) => {
          this.stderr += data.toString();
          process.stderr.write(data);
        });

        childProcess.once("exit", (code, signal) => {
          if (this.process !== childProcess) return;
          const error = this.createProcessExitError(code, signal);
          this.exitError = error;
          this.rejectPendingRequests(error);
        });
        childProcess.once("error", (error) => {
          if (this.process !== childProcess) return;
          const processError = new Error(
            `Agent process error: ${error.message}. Stderr: ${this.stderr}`,
          );
          this.exitError = processError;
          this.rejectPendingRequests(processError);
        });
        childProcess.stdin?.on("error", (error) => {
          if (this.process !== childProcess) return;
          const stdinError =
            this.exitError ??
            new Error(`Agent process stdin error: ${error.message}. Stderr: ${this.stderr}`);
          this.exitError = stdinError;
          this.rejectPendingRequests(stdinError);
        });

        this.stopReadingStdout = attachJsonlLineReader(childProcess.stdout!, (line) => {
          this.handleLine(line);
        });

        yield* performed(Effect.sleep(100));

        if (this.process.exitCode !== null) {
          const error =
            this.exitError ??
            this.createProcessExitError(this.process.exitCode, this.process.signalCode);
          this.exitError = error;
          throw error;
        }
      }, this),
    );
  }

  stop(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.process === null) return;

        this.stopReadingStdout?.();
        this.stopReadingStdout = null;
        this.process.kill("SIGTERM");

        yield* performed(
          Effect.callback<void>((resume) => {
            this.process?.on("exit", () => resume(Effect.void));
          }).pipe(
            Effect.timeoutOrElse({
              duration: 1000,
              orElse: () =>
                Effect.sync(() => {
                  this.process?.kill("SIGKILL");
                }),
            }),
          ),
        );

        this.process = null;
        this.pendingRequests.clear();
      }, this),
    );
  }

  onEvent(listener: RpcEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  getStderr(): string {
    return this.stderr;
  }

  prompt(
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
  ): Promise<PromptDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(
          this.send({ type: "prompt", message, images, streamingBehavior }),
        );
        return this.getData<{ disposition: PromptDisposition }>(response).disposition;
      }, this),
    );
  }

  ask(message: string, images?: ImageContent[]): Promise<PromptDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(
          this.send({ type: "prompt", message, images, mode: "ask" }),
        );
        return this.getData<{ disposition: PromptDisposition }>(response).disposition;
      }, this),
    );
  }

  steer(message: string, images?: ImageContent[]): Promise<QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "steer", message, images }));
        return this.getData<{ disposition: QueuedInputDisposition }>(response).disposition;
      }, this),
    );
  }

  followUp(message: string, images?: ImageContent[]): Promise<QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "follow_up", message, images }));
        return this.getData<{ disposition: QueuedInputDisposition }>(response).disposition;
      }, this),
    );
  }

  abort(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "abort" }));
      }, this),
    );
  }

  clearQueue(): Promise<{ steering: string[]; followUp: string[] }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "clear_queue" }));
        return this.getData(response);
      }, this),
    );
  }

  newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "new_session", parentSession }));
        return this.getData(response);
      }, this),
    );
  }

  getState(): Promise<RpcSessionState> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_state" }));
        return this.getData(response);
      }, this),
    );
  }

  setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "set_model", provider, modelId }));
        return this.getData(response);
      }, this),
    );
  }

  cycleModel(): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: ThinkingLevel;
    isScoped: boolean;
  } | null> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "cycle_model" }));
        return this.getData(response);
      }, this),
    );
  }

  getAvailableModels(): Promise<ModelInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_available_models" }));
        return this.getData<{ models: ModelInfo[] }>(response).models;
      }, this),
    );
  }

  setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "set_thinking_level", level }));
      }, this),
    );
  }

  cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "cycle_thinking_level" }));
        return this.getData(response);
      }, this),
    );
  }

  getAvailableThinkingLevels(): Promise<ThinkingLevel[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_available_thinking_levels" }));
        return this.getData<{ levels: ThinkingLevel[] }>(response).levels;
      }, this),
    );
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "set_steering_mode", mode }));
      }, this),
    );
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "set_follow_up_mode", mode }));
      }, this),
    );
  }

  compact(customInstructions?: string): Promise<CompactionResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "compact", customInstructions }));
        return this.getData(response);
      }, this),
    );
  }

  setAutoCompaction(enabled: boolean): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.send({ type: "set_auto_compaction", enabled }));
    }, this);
  }

  setAutoRetry(enabled: boolean): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.send({ type: "set_auto_retry", enabled }));
    }, this);
  }

  abortRetry(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "abort_retry" }));
      }, this),
    );
  }

  bash(command: string): Promise<BashResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "bash", command }));
        return this.getData(response);
      }, this),
    );
  }

  abortBash(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "abort_bash" }));
      }, this),
    );
  }

  getSessionStats(): Promise<SessionStats> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_session_stats" }));
        return this.getData(response);
      }, this),
    );
  }

  exportHtml(outputPath?: string): Promise<{ path: string }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "export_html", outputPath }));
        return this.getData(response);
      }, this),
    );
  }

  switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "switch_session", sessionPath }));
        return this.getData(response);
      }, this),
    );
  }

  fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "fork", entryId }));
        return this.getData(response);
      }, this),
    );
  }

  clone(): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "clone" }));
        return this.getData(response);
      }, this),
    );
  }

  getForkMessages(): Effect.Effect<Array<{ entryId: string; text: string }>> {
    return awaitingWith(function* () {
      const response = yield* awaited(this.send({ type: "get_fork_messages" }));
      return this.getData<{ messages: Array<{ entryId: string; text: string }> }>(response)
        .messages;
    }, this);
  }

  getEntries(since?: string): Promise<{ entries: SessionEntry[]; leafId: string | null }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_entries", since }));
        return this.getData<{ entries: SessionEntry[]; leafId: string | null }>(response);
      }, this),
    );
  }

  getTree(): Promise<{ tree: SessionTreeNode[]; leafId: string | null }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_tree" }));
        return this.getData<{ tree: SessionTreeNode[]; leafId: string | null }>(response);
      }, this),
    );
  }

  getLastAssistantText(): Promise<string | null> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_last_assistant_text" }));
        return this.getData<{ text: string | null }>(response).text;
      }, this),
    );
  }

  setSessionName(name: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ type: "set_session_name", name }));
      }, this),
    );
  }

  getMessages(): Effect.Effect<AgentMessage[]> {
    return awaitingWith(function* () {
      const response = yield* awaited(this.send({ type: "get_messages" }));
      return this.getData<{ messages: AgentMessage[] }>(response).messages;
    }, this);
  }

  getCommands(): Promise<RpcSlashCommand[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_commands" }));
        return this.getData<{ commands: RpcSlashCommand[] }>(response).commands;
      }, this),
    );
  }

  waitForIdle(timeout = 60000): Promise<void> {
    return Effect.runPromise(
      Effect.callback<void>((resume) => {
        const unsubscribe = this.onEvent((event) => {
          if (event.type === "agent_settled") resume(Effect.void);
        });
        return Effect.sync(unsubscribe);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.die(
              new Error(`Timeout waiting for agent to become idle. Stderr: ${this.stderr}`),
            ),
        }),
      ),
    );
  }

  collectEvents(timeout = 60000): Promise<JsonAgentSessionEvent[]> {
    return Effect.runPromise(
      Effect.callback<JsonAgentSessionEvent[]>((resume) => {
        const events: JsonAgentSessionEvent[] = [];
        const unsubscribe = this.onEvent((event) => {
          events.push(event);
          if (event.type === "agent_settled") resume(Effect.succeed(events));
        });
        return Effect.sync(unsubscribe);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.die(new Error(`Timeout collecting events. Stderr: ${this.stderr}`)),
        }),
      ),
    );
  }

  promptAndWait(
    message: string,
    images?: ImageContent[],
    timeout = 60000,
  ): Promise<JsonAgentSessionEvent[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const eventsPromise = this.collectEvents(timeout);
        yield* awaited(this.prompt(message, images));
        return yield* awaited(eventsPromise);
      }, this),
    );
  }

  private handleLine(line: string): void {
    try {
      const data = JSON.parse(line);

      if (
        data.type === "response" &&
        typeof data.id === "string" &&
        data.id !== "" &&
        this.pendingRequests.has(data.id)
      ) {
        const pending = this.pendingRequests.get(data.id)!;
        this.pendingRequests.delete(data.id);
        pending.resolve(data as RpcResponse);
        return;
      }

      for (const listener of [...this.eventListeners]) {
        listener(data as JsonAgentSessionEvent);
      }
    } catch {}
  }

  private createProcessExitError(code: number | null, signal: NodeJS.Signals | null): Error {
    return new Error(
      `Agent process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`,
    );
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private send(command: RpcCommandBody): Promise<RpcResponse> {
    return Effect.runPromise(
      Effect.suspend(() => {
        const childProcess = this.process;
        const stdin = childProcess?.stdin;
        if (childProcess === null || stdin === undefined || stdin === null) {
          throw new Error("Client not started");
        }
        if (this.exitError !== null) {
          throw this.exitError;
        }
        if (childProcess.exitCode !== null) {
          const error = this.createProcessExitError(childProcess.exitCode, childProcess.signalCode);
          this.exitError = error;
          throw error;
        }
        if (stdin.destroyed || !stdin.writable) {
          const error = new Error(`Agent process stdin is not writable. Stderr: ${this.stderr}`);
          this.exitError = error;
          throw error;
        }

        const id = `req_${++this.requestId}`;
        const fullCommand = { ...command, id } as RpcCommand;

        return Effect.callback<RpcResponse>((resume) => {
          this.pendingRequests.set(id, {
            resolve: (response) => resume(Effect.succeed(response)),
            reject: (error) => resume(Effect.die(error)),
          });

          try {
            stdin.write(serializeJsonLine(fullCommand));
          } catch (error: unknown) {
            const writeError = error instanceof Error ? error : new Error(String(error));
            const pending = this.pendingRequests.get(id);
            this.pendingRequests.delete(id);
            pending?.reject(writeError);
          }
          return Effect.sync(() => {
            this.pendingRequests.delete(id);
          });
        }).pipe(
          Effect.timeoutOrElse({
            duration: 30000,
            orElse: () =>
              Effect.die(
                new Error(
                  `Timeout waiting for response to ${command.type}. Stderr: ${this.stderr}`,
                ),
              ),
          }),
        );
      }),
    );
  }

  private getData<T>(response: RpcResponse): T {
    if (!response.success) {
      const errorResponse = response as Extract<RpcResponse, { success: false }>;
      throw new Error(errorResponse.error);
    }
    const successResponse = response as Extract<RpcResponse, { success: true; data: unknown }>;
    return successResponse.data as T;
  }
}
