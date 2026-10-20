import type agentTypes from "@msa/agent-core/index.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer22 from "./agent-session-layer-22.ts";
import awaitingModule from "./awaiting.ts";
import type runnerTypes from "./extensions/runner.types.ts";
import memoryFormat from "./memory/memory-format.ts";
import memoryModule from "./memory/memory.ts";
import platform from "./platform.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { nowMs } = platform;
const { MEMORY_RECALL_MESSAGE_TYPE } = memoryModule;
const { formatRecallBlock } = memoryFormat;

export default abstract class AgentSessionLayer23 extends AgentSessionLayer22 {
  protected triggerMessages(
    trigger: runnerTypes.BeforeAgentStartTrigger,
  ): Effect.Effect<agentTypes.AgentMessage[]> {
    return awaitingWith(function* () {
      if (trigger.messageType === "custom") return [trigger.message];
      const normalized = yield* performed(this.normalizePromptImages(trigger.images));
      const text =
        normalized.hints.length > 0
          ? `${trigger.prompt}\n\n${normalized.hints.join("\n")}`
          : trigger.prompt;
      const messages: agentTypes.AgentMessage[] = [
        {
          content: [{ text, type: "text" }, ...normalized.images],
          role: "user",
          timestamp: nowMs(),
        },
      ];
      if (this.memoryInternal === undefined) return messages;
      const recalled = yield* awaited(this.memoryInternal.recall(trigger.prompt));
      if (recalled.length === 0) return messages;
      return [
        {
          content: formatRecallBlock(recalled),
          customType: MEMORY_RECALL_MESSAGE_TYPE,
          display: false,
          role: "custom",
          timestamp: nowMs(),
        },
        ...messages,
      ];
    }, this);
  }
}
