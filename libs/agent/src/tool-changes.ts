import {
  getCurrentTools,
  getToolStateChanges,
  type SystemMessage,
  type ToolStateChanges,
  toToolDeclaration,
} from "@msa/ai";

import { now } from "./call.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage, ThinkingLevel } from "./types.ts";

const NO_CHANGES: ToolStateChanges = { toolsAdded: [], toolsRemoved: [] };

const withToolChanges = (
  message: SystemMessage,
  { toolsAdded, toolsRemoved }: ToolStateChanges,
): SystemMessage => {
  const { toolsAdded: _added, toolsRemoved: _removed, ...rest } = message;
  return {
    ...rest,
    ...(toolsAdded.length > 0 ? { toolsAdded } : {}),
    ...(toolsRemoved.length > 0 ? { toolsRemoved } : {}),
  };
};

const declaresNothing = (message: SystemMessage): boolean =>
  (message.toolsAdded?.length ?? 0) === 0 && (message.toolsRemoved?.length ?? 0) === 0;

export interface PendingMessages {
  readonly context: AgentContext;
  readonly messages: AgentMessage[];
}

export const declareToolChanges = ({ context, messages }: PendingMessages): AgentMessage[] => {
  const systemIndex = messages.findLastIndex((message) => message.role === "system");
  const pending = messages[systemIndex] as SystemMessage | undefined;
  const baseline =
    pending === undefined
      ? messages
      : messages.map((message, index) =>
          index === systemIndex ? withToolChanges(pending, NO_CHANGES) : message,
        );
  const changes = getToolStateChanges(
    getCurrentTools([...context.messages, ...baseline]),
    (context.tools ?? []).map(toToolDeclaration),
  );
  const unchanged = changes.toolsAdded.length === 0 && changes.toolsRemoved.length === 0;

  if (pending !== undefined) {
    if (unchanged && declaresNothing(pending)) return messages;
    return baseline.map((message, index) =>
      index === systemIndex ? withToolChanges(pending, changes) : message,
    );
  }
  if (unchanged) return messages;
  const update = withToolChanges({ role: "system", content: "", timestamp: now() }, changes);
  const insertIndex = messages.findIndex((message) => message.role !== "system");
  const index = insertIndex === -1 ? messages.length : insertIndex;
  return [...messages.slice(0, index), update, ...messages.slice(index)];
};

export interface RequestState {
  readonly config: AgentLoopConfig;
  readonly model: AgentLoopConfig["model"];
  readonly thinkingLevel: ThinkingLevel | undefined;
}

const nextReasoning = (
  current: AgentLoopConfig["reasoning"],
  thinkingLevel: ThinkingLevel | undefined,
): AgentLoopConfig["reasoning"] => {
  if (thinkingLevel === undefined) return current;
  return thinkingLevel === "off" ? undefined : thinkingLevel;
};

export const withRequestState = ({
  config,
  model,
  thinkingLevel,
}: RequestState): AgentLoopConfig => {
  const { reasoning, ...rest } = config;
  const next = nextReasoning(reasoning, thinkingLevel);
  return next === undefined ? { ...rest, model } : { ...rest, model, reasoning: next };
};
