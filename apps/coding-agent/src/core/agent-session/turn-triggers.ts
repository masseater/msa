import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import imageProcess from "../../utils/image-process.ts";
import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import type runnerTypes from "../extensions/runner.types.ts";
import memoryModule from "../memory/memory.ts";
import platform from "../platform/index.ts";

const { nowMs } = platform;
const { awaited, awaitingWith, performed } = awaitingModule;
const { processImage } = imageProcess;
const { MEMORY_RECALL_MESSAGE_TYPE } = memoryModule;

export default class SessionTurnTriggers {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private normalizePromptImages(
    images: compatTypes.ImageContent[] | undefined,
  ): Effect.Effect<{ images: compatTypes.ImageContent[]; hints: string[] }> {
    return awaitingWith(function* () {
      if (images === undefined) return { hints: [], images: [] };

      const normalizedImages: compatTypes.ImageContent[] = [];
      const hints: string[] = [];
      for (const image of images) {
        const processed = yield* awaited(
          processImage(Buffer.from(image.data, "base64"), image.mimeType, {
            autoResizeImages: this.session.settingsManager.display.getImageAutoResize(),
            resizeOptions: this.session.models.selection.limitsModel()?.inputLimits?.images?.resize,
          }),
        );
        if (!processed.ok) {
          hints.push(processed.message);
          continue;
        }
        normalizedImages.push({
          data: processed.data,
          mimeType: processed.mimeType,
          type: "image",
        });
        hints.push(...processed.hints);
      }
      return { hints, images: normalizedImages };
    }, this);
  }

  triggerMessages(
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
      const memory = this.session.integrations.memory.memoryInternal;
      if (memory === undefined) return messages;
      this.session.integrations.memory.migrateInBackground();
      const recalled = yield* awaited(memory.recall(trigger.prompt));
      if (recalled === undefined) return messages;
      return [
        {
          content: [
            "<memory>",
            "Long-term memory from sepiace, recalled for this request. The memory tool can remember, recall, and forget.",
            recalled,
            "</memory>",
          ].join("\n"),
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
