import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import callModule from "./call.ts";
import type toolChangesTypes from "./tool-changes.types.ts";
import type typesModule from "./types.ts";

const { getCurrentTools, getToolStateChanges, toToolDeclaration } = ai;

const { now } = callModule;

const NO_CHANGES: aiTypes.ToolStateChanges = { toolsAdded: [], toolsRemoved: [] };

const withToolChanges = (
  message: aiTypes.SystemMessage,
  { toolsAdded, toolsRemoved }: aiTypes.ToolStateChanges,
): aiTypes.SystemMessage => {
  const { toolsAdded: _added, toolsRemoved: _removed, ...rest } = message;
  return {
    ...rest,
    ...(toolsAdded.length > 0 ? { toolsAdded } : {}),
    ...(toolsRemoved.length > 0 ? { toolsRemoved } : {}),
  };
};

const declaresNothing = (message: aiTypes.SystemMessage): boolean =>
  (message.toolsAdded?.length ?? 0) === 0 && (message.toolsRemoved?.length ?? 0) === 0;

const declareToolChanges = ({
  context,
  messages,
}: toolChangesTypes.PendingMessages): typesModule.AgentMessage[] => {
  const systemIndex = messages.findLastIndex((message) => message.role === "system");
  const pending = messages[systemIndex] as aiTypes.SystemMessage | undefined;
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
  const update = withToolChanges({ content: "", role: "system", timestamp: now() }, changes);
  const insertIndex = messages.findIndex((message) => message.role !== "system");
  const index = insertIndex === -1 ? messages.length : insertIndex;
  return [...messages.slice(0, index), update, ...messages.slice(index)];
};

const nextReasoning = (
  current: typesModule.AgentLoopConfig["reasoning"],
  thinkingLevel: typesModule.ThinkingLevel | undefined,
): typesModule.AgentLoopConfig["reasoning"] => {
  if (thinkingLevel === undefined) return current;
  return thinkingLevel === "off" ? undefined : thinkingLevel;
};

const withRequestState = ({
  config,
  model,
  thinkingLevel,
}: toolChangesTypes.RequestState): typesModule.AgentLoopConfig => {
  const { reasoning, ...rest } = config;
  const next = nextReasoning(reasoning, thinkingLevel);
  return next === undefined ? { ...rest, model } : { ...rest, model, reasoning: next };
};

const toolChanges = {
  declareToolChanges,
  withRequestState,
};

export default toolChanges;
