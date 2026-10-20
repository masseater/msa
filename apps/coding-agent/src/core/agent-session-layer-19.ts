import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import AgentSessionLayer18 from "./agent-session-layer-18.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import memoryFormat from "./memory/memory-format.ts";
import type memoryTypes from "./memory/memory.types.ts";
import promptTemplatesModule from "./prompt-templates.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { expandPromptTemplate } = promptTemplatesModule;
const { formatMemoryList, formatSearchResults } = memoryFormat;

export default abstract class AgentSessionLayer19 extends AgentSessionLayer18 {
  protected queueUserInput(
    text: string,
    images: compatTypes.ImageContent[] | undefined,
    behavior: "steer" | "followUp",
    source: extensionsTypes.InputSource,
  ): Effect.Effect<agentSessionTypes.QueuedInputDisposition> {
    return awaitingWith(function* () {
      if (text.startsWith("/")) {
        this.throwIfExtensionCommand(text);
      }

      const processedInput = yield* performed(
        this.runInputHandlers(text, images, source, this.isStreaming ? behavior : undefined),
      );
      if (processedInput === undefined) return "handled";

      let expandedText = this.expandSkillCommand(processedInput.text);
      expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

      if (behavior === "steer") {
        yield* performed(this.queueSteer(expandedText, processedInput.images));
      } else {
        yield* performed(this.queueFollowUp(expandedText, processedInput.images));
      }
      return "queued";
    }, this);
  }

  steer(
    text: string,
    images?: compatTypes.ImageContent[],
    options?: { source?: extensionsTypes.InputSource },
  ): Promise<agentSessionTypes.QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* performed(
          this.queueUserInput(text, images, "steer", options?.source ?? "interactive"),
        );
      }, this),
    );
  }

  followUp(
    text: string,
    images?: compatTypes.ImageContent[],
    options?: { source?: extensionsTypes.InputSource },
  ): Promise<agentSessionTypes.QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* performed(
          this.queueUserInput(text, images, "followUp", options?.source ?? "interactive"),
        );
      }, this),
    );
  }

  protected runMemoryCommand(
    command: memoryTypes.MemoryCommand,
    options?: agentSessionTypes.PromptOptions,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const memory = this.memoryInternal;
      let text: string;
      if (memory === undefined) {
        text = "Memory is disabled (settings: memory.enabled).";
      } else {
        switch (command.kind) {
          case "status":
            text = memory.describeStatus();
            break;
          case "stats":
            text = memory.describeStats();
            break;
          case "list":
            text = formatMemoryList(memory.list(20));
            break;
          case "search":
            text = formatSearchResults(yield* awaited(memory.search(command.query, 10)));
            break;
          case "forget":
            text = memory.forget(command.id)
              ? `Forgot memory ${command.id}.`
              : `No memory with id ${command.id}.`;
            break;
        }
      }
      this.emit({ text, type: "memory_status" });
      options?.preflightResult?.("handled");
    }, this);
  }
}
