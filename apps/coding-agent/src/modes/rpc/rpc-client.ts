import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type jsonEventTypes from "../json-event.types.ts";
import type rpcClientTypes from "./rpc-client.types.ts";
import RpcConnection from "./rpc-client/rpc-connection.ts";
import type rpcTypesTypes from "./rpc-types.ts";

const { awaited, awaitingWith } = awaitingModule;

export default class RpcClient {
  readonly connection: RpcConnection;

  options!: rpcClientTypes.RpcClientOptions;

  abort(): Promise<void> {
    return this.connection.command({ type: "abort" });
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return this.connection.command({ mode, type: "set_steering_mode" });
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return this.connection.command({ mode, type: "set_follow_up_mode" });
  }

  setAutoCompaction(enabled: boolean): Effect.Effect<void> {
    return Effect.promise(() => this.connection.command({ enabled, type: "set_auto_compaction" }));
  }

  setAutoRetry(enabled: boolean): Effect.Effect<void> {
    return Effect.promise(() => this.connection.command({ enabled, type: "set_auto_retry" }));
  }

  abortRetry(): Promise<void> {
    return this.connection.command({ type: "abort_retry" });
  }

  abortBash(): Promise<void> {
    return this.connection.command({ type: "abort_bash" });
  }

  getForkMessages(): Effect.Effect<Array<{ entryId: string; text: string }>> {
    return Effect.promise(() =>
      this.connection.requestField<
        { messages: Array<{ entryId: string; text: string }> },
        "messages"
      >({ type: "get_fork_messages" }, "messages"),
    );
  }

  setSessionName(name: string): Promise<void> {
    return this.connection.command({ name, type: "set_session_name" });
  }

  clearQueue(): Promise<{ steering: string[]; followUp: string[] }> {
    return this.connection.request({ type: "clear_queue" });
  }

  newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
    return this.connection.request({ parentSession, type: "new_session" });
  }

  getState(): Promise<rpcTypesTypes.RpcSessionState> {
    return this.connection.request({ type: "get_state" });
  }

  setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
    return this.connection.request({ modelId, provider, type: "set_model" });
  }

  cycleModel(): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: agentTypes.ThinkingLevel;
    isScoped: boolean;
  } | null> {
    return this.connection.request({ type: "cycle_model" });
  }

  getAvailableModels(): Promise<rpcClientTypes.ModelInfo[]> {
    return this.connection.requestField<{ models: rpcClientTypes.ModelInfo[] }, "models">(
      { type: "get_available_models" },
      "models",
    );
  }

  setThinkingLevel(level: agentTypes.ThinkingLevel): Promise<void> {
    return this.connection.command({ level, type: "set_thinking_level" });
  }

  cycleThinkingLevel(): Promise<{ level: agentTypes.ThinkingLevel } | null> {
    return this.connection.request({ type: "cycle_thinking_level" });
  }

  getAvailableThinkingLevels(): Promise<agentTypes.ThinkingLevel[]> {
    return this.connection.requestField<{ levels: agentTypes.ThinkingLevel[] }, "levels">(
      { type: "get_available_thinking_levels" },
      "levels",
    );
  }

  compact(customInstructions?: string): Promise<rpcClientTypes.CompactionResult> {
    return this.connection.request({ customInstructions, type: "compact" });
  }

  bash(command: string): Promise<rpcClientTypes.BashResult> {
    return this.connection.request({ command, type: "bash" });
  }

  getSessionStats(): Promise<rpcClientTypes.SessionStats> {
    return this.connection.request({ type: "get_session_stats" });
  }

  exportHtml(outputPath?: string): Promise<{ path: string }> {
    return this.connection.request({ outputPath, type: "export_html" });
  }

  switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return this.connection.request({ sessionPath, type: "switch_session" });
  }

  fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return this.connection.request({ entryId, type: "fork" });
  }

  clone(): Promise<{ cancelled: boolean }> {
    return this.connection.request({ type: "clone" });
  }

  getEntries(
    since?: string,
  ): Promise<{ entries: rpcClientTypes.SessionEntry[]; leafId: string | null }> {
    return this.connection.request({ since, type: "get_entries" });
  }

  getTree(): Promise<{ tree: rpcClientTypes.SessionTreeNode[]; leafId: string | null }> {
    return this.connection.request({ type: "get_tree" });
  }

  getLastAssistantText(): Promise<string | null> {
    return this.connection.requestField<{ text: string | null }, "text">(
      { type: "get_last_assistant_text" },
      "text",
    );
  }

  getMessages(): Effect.Effect<agentTypes.AgentMessage[]> {
    return Effect.promise(() =>
      this.connection.requestField<{ messages: agentTypes.AgentMessage[] }, "messages">(
        { type: "get_messages" },
        "messages",
      ),
    );
  }

  getCommands(): Promise<rpcTypesTypes.RpcSlashCommand[]> {
    return this.connection.requestField<{ commands: rpcTypesTypes.RpcSlashCommand[] }, "commands">(
      { type: "get_commands" },
      "commands",
    );
  }

  prompt(
    message: string,
    images?: aiTypes.ImageContent[],
    streamingBehavior?: "steer" | "followUp",
  ): Promise<rpcClientTypes.PromptDisposition> {
    return this.connection.requestField<
      { disposition: rpcClientTypes.PromptDisposition },
      "disposition"
    >({ images, message, streamingBehavior, type: "prompt" }, "disposition");
  }

  ask(message: string, images?: aiTypes.ImageContent[]): Promise<rpcClientTypes.PromptDisposition> {
    return this.connection.requestField<
      { disposition: rpcClientTypes.PromptDisposition },
      "disposition"
    >({ images, message, mode: "ask", type: "prompt" }, "disposition");
  }

  steer(
    message: string,
    images?: aiTypes.ImageContent[],
  ): Promise<rpcClientTypes.QueuedInputDisposition> {
    return this.connection.requestField<
      { disposition: rpcClientTypes.QueuedInputDisposition },
      "disposition"
    >({ images, message, type: "steer" }, "disposition");
  }

  followUp(
    message: string,
    images?: aiTypes.ImageContent[],
  ): Promise<rpcClientTypes.QueuedInputDisposition> {
    return this.connection.requestField<
      { disposition: rpcClientTypes.QueuedInputDisposition },
      "disposition"
    >({ images, message, type: "follow_up" }, "disposition");
  }

  promptAndWait(
    message: string,
    images?: aiTypes.ImageContent[],
    timeout = 60000,
  ): Promise<jsonEventTypes.JsonAgentSessionEvent[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const eventsPromise = this.collectEvents(timeout);
        yield* awaited(this.prompt(message, images));
        return yield* awaited(eventsPromise);
      }, this),
    );
  }

  start(): Promise<void> {
    return this.connection.start();
  }

  stop(): Promise<void> {
    return this.connection.stop();
  }

  onEvent(listener: rpcClientTypes.RpcEventListener): () => void {
    return this.connection.onEvent(listener);
  }

  getStderr(): string {
    return this.connection.getStderr();
  }

  waitForIdle(timeout = 60000): Promise<void> {
    return Effect.runPromise(
      Effect.callback<void>((resume) => {
        const unsubscribe = this.connection.onEvent((event) => {
          if (event.type === "agent_settled") resume(Effect.void);
        });
        return Effect.sync(unsubscribe);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.die(
              new Error(
                `Timeout waiting for agent to become idle. Stderr: ${this.connection.getStderr()}`,
              ),
            ),
        }),
      ),
    );
  }

  collectEvents(timeout = 60000): Promise<jsonEventTypes.JsonAgentSessionEvent[]> {
    return Effect.runPromise(
      Effect.callback<jsonEventTypes.JsonAgentSessionEvent[]>((resume) => {
        const events: jsonEventTypes.JsonAgentSessionEvent[] = [];
        const unsubscribe = this.connection.onEvent((event) => {
          events.push(event);
          if (event.type === "agent_settled") resume(Effect.succeed(events));
        });
        return Effect.sync(unsubscribe);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.die(
              new Error(`Timeout collecting events. Stderr: ${this.connection.getStderr()}`),
            ),
        }),
      ),
    );
  }

  constructor(options: rpcClientTypes.RpcClientOptions = {}) {
    this.connection = new RpcConnection(this);
    this.options = options;
  }
}
