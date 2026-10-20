import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { Function as Fn } from "effect";

import type { Extension, ExtensionEvent, UserBashEventResult } from "./types.ts";

const { getCurrentSystemMessage } = ai;

export function isUserBashEventResult(value: unknown): value is UserBashEventResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const hasOperations = candidate["operations"] !== undefined;
  const hasResult = candidate["result"] !== undefined;
  if (hasOperations === hasResult) return false;

  if (hasOperations) {
    const operations = candidate["operations"];
    if (typeof operations !== "object" || operations === null) return false;
    return typeof (operations as Record<string, unknown>)["exec"] === "function";
  }

  const result = candidate["result"];
  if (typeof result !== "object" || result === null) return false;
  const resultRecord = result as Record<string, unknown>;
  return (
    typeof resultRecord["output"] === "string" &&
    "exitCode" in resultRecord &&
    (resultRecord["exitCode"] === undefined || typeof resultRecord["exitCode"] === "number") &&
    typeof resultRecord["cancelled"] === "boolean" &&
    typeof resultRecord["truncated"] === "boolean" &&
    (resultRecord["fullOutputPath"] === undefined ||
      typeof resultRecord["fullOutputPath"] === "string")
  );
}

const snapshotEventHandlersImpl = (extensions: Extension[], event: ExtensionEvent["type"]) =>
  extensions.map((ext) => ({ ext, handlers: ext.handlers.get(event)?.slice() ?? [] }));

export const snapshotEventHandlers: {
  (
    event: ExtensionEvent["type"],
  ): (extensions: Extension[]) => ReturnType<typeof snapshotEventHandlersImpl>;
  (
    extensions: Extension[],
    event: ExtensionEvent["type"],
  ): ReturnType<typeof snapshotEventHandlersImpl>;
} = Fn.dual(2, snapshotEventHandlersImpl);

export const sameMessages: {
  (right: agentTypes.AgentMessage[]): (left: agentTypes.AgentMessage[]) => boolean;
  (left: agentTypes.AgentMessage[], right: agentTypes.AgentMessage[]): boolean;
} = Fn.dual(
  2,
  (left: agentTypes.AgentMessage[], right: agentTypes.AgentMessage[]): boolean =>
    left.length === right.length && left.every((message, index) => message === right[index]),
);

export const restoreSystemMessages: {
  (
    visible: agentTypes.AgentMessage[],
    returned: agentTypes.AgentMessage[],
  ): (current: agentTypes.AgentMessage[]) => agentTypes.AgentMessage[];
  (
    current: agentTypes.AgentMessage[],
    visible: agentTypes.AgentMessage[],
    returned: agentTypes.AgentMessage[],
  ): agentTypes.AgentMessage[];
} = Fn.dual(
  3,
  (
    current: agentTypes.AgentMessage[],
    visible: agentTypes.AgentMessage[],
    returned: agentTypes.AgentMessage[],
  ): agentTypes.AgentMessage[] => {
    if (sameMessages(returned, visible)) return current;
    const head = getCurrentSystemMessage(current);
    return head === undefined ? returned : [head, ...returned];
  },
);
