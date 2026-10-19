import type { AgentMessage } from "@msa/agent-core";
import { getCurrentSystemMessage } from "@msa/ai";
import { Function as Fn } from "effect";

import type { Extension, ExtensionEvent, UserBashEventResult } from "./types.ts";

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
  (right: AgentMessage[]): (left: AgentMessage[]) => boolean;
  (left: AgentMessage[], right: AgentMessage[]): boolean;
} = Fn.dual(
  2,
  (left: AgentMessage[], right: AgentMessage[]): boolean =>
    left.length === right.length && left.every((message, index) => message === right[index]),
);

export const restoreSystemMessages: {
  (visible: AgentMessage[], returned: AgentMessage[]): (current: AgentMessage[]) => AgentMessage[];
  (current: AgentMessage[], visible: AgentMessage[], returned: AgentMessage[]): AgentMessage[];
} = Fn.dual(
  3,
  (current: AgentMessage[], visible: AgentMessage[], returned: AgentMessage[]): AgentMessage[] => {
    if (sameMessages(returned, visible)) return current;
    const head = getCurrentSystemMessage(current);
    return head === undefined ? returned : [head, ...returned];
  },
);
