import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import type bashExecutorTypes from "../../core/bash-executor.types.ts";
import type compactionTypes from "../../core/compaction/index.types.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
import RpcClientLayer1 from "./rpc-client-layer-1.ts";
import type rpcClientTypes from "./rpc-client.types.ts";
import type rpcTypesTypes from "./rpc-types.ts";

const { awaited, awaitingWith } = awaitingModule;

export default abstract class RpcClientLayer2 extends RpcClientLayer1 {
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
        const response = yield* awaited(this.send({ parentSession, type: "new_session" }));
        return this.getData(response);
      }, this),
    );
  }

  getState(): Promise<rpcTypesTypes.RpcSessionState> {
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
        const response = yield* awaited(this.send({ modelId, provider, type: "set_model" }));
        return this.getData(response);
      }, this),
    );
  }

  cycleModel(): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: agentTypes.ThinkingLevel;
    isScoped: boolean;
  } | null> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "cycle_model" }));
        return this.getData(response);
      }, this),
    );
  }

  getAvailableModels(): Promise<rpcClientTypes.ModelInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_available_models" }));
        return this.getData<{ models: rpcClientTypes.ModelInfo[] }>(response).models;
      }, this),
    );
  }

  setThinkingLevel(level: agentTypes.ThinkingLevel): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.send({ level, type: "set_thinking_level" }));
      }, this),
    );
  }

  cycleThinkingLevel(): Promise<{ level: agentTypes.ThinkingLevel } | null> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "cycle_thinking_level" }));
        return this.getData(response);
      }, this),
    );
  }

  getAvailableThinkingLevels(): Promise<agentTypes.ThinkingLevel[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_available_thinking_levels" }));
        return this.getData<{ levels: agentTypes.ThinkingLevel[] }>(response).levels;
      }, this),
    );
  }

  compact(customInstructions?: string): Promise<compactionTypes.CompactionResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ customInstructions, type: "compact" }));
        return this.getData(response);
      }, this),
    );
  }

  bash(command: string): Promise<bashExecutorTypes.BashResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ command, type: "bash" }));
        return this.getData(response);
      }, this),
    );
  }

  getSessionStats(): Promise<agentSessionTypes.SessionStats> {
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
        const response = yield* awaited(this.send({ outputPath, type: "export_html" }));
        return this.getData(response);
      }, this),
    );
  }

  switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ sessionPath, type: "switch_session" }));
        return this.getData(response);
      }, this),
    );
  }

  fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ entryId, type: "fork" }));
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

  getEntries(
    since?: string,
  ): Promise<{ entries: sessionManagerTypes.SessionEntry[]; leafId: string | null }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ since, type: "get_entries" }));
        return this.getData<{ entries: sessionManagerTypes.SessionEntry[]; leafId: string | null }>(
          response,
        );
      }, this),
    );
  }

  getTree(): Promise<{ tree: sessionManagerTypes.SessionTreeNode[]; leafId: string | null }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_tree" }));
        return this.getData<{ tree: sessionManagerTypes.SessionTreeNode[]; leafId: string | null }>(
          response,
        );
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

  getMessages(): Effect.Effect<agentTypes.AgentMessage[]> {
    return awaitingWith(function* () {
      const response = yield* awaited(this.send({ type: "get_messages" }));
      return this.getData<{ messages: agentTypes.AgentMessage[] }>(response).messages;
    }, this);
  }

  getCommands(): Promise<rpcTypesTypes.RpcSlashCommand[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const response = yield* awaited(this.send({ type: "get_commands" }));
        return this.getData<{ commands: rpcTypesTypes.RpcSlashCommand[] }>(response).commands;
      }, this),
    );
  }
}
