import type agentSessionTypes from "../../core/agent-session.types.ts";
import type bashExecutorTypes from "../../core/bash-executor.types.ts";
import type compactionTypes from "../../core/compaction/index.types.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
import type jsonEventTypes from "../json-event.types.ts";
import type RpcClientClass from "./rpc-client.ts";

declare namespace rpcClientTypes {
  interface RpcClientOptions {
    cliPath?: string;
    cwd?: string;
    env?: Record<string, string>;
    provider?: string;
    model?: string;
    args?: string[];
  }

  interface ModelInfo {
    provider: string;
    id: string;
    contextWindow: number;
    reasoning: boolean;
  }

  type BashResult = bashExecutorTypes.BashResult;

  type CompactionResult = compactionTypes.CompactionResult;

  type SessionStats = agentSessionTypes.SessionStats;

  type PromptDisposition = agentSessionTypes.PromptDisposition;

  type QueuedInputDisposition = agentSessionTypes.QueuedInputDisposition;

  type SessionEntry = sessionManagerTypes.SessionEntry;

  type SessionTreeNode = sessionManagerTypes.SessionTreeNode;

  type RpcEventListener = (event: jsonEventTypes.JsonAgentSessionEvent) => void;

  type RpcClient = (typeof RpcClientClass)["prototype"];
}

export type { rpcClientTypes as default };
