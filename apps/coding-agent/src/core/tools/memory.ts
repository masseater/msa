import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type memoryTypes from "../memory/memory.types.ts";

const NOTHING = "sepiace returned nothing.";

const memorySchema = Type.Object({
  request: Type.String({
    description:
      "One natural-language request for sepiace: a fact to remember, a question to recall, or what to forget.",
  }),
});

const memoryToolSystemPromptContribution = {
  guidelines: [
    "Use the memory tool to save durable facts, user preferences, and decisions that future sessions need; do not save transient details",
  ],
  snippet: "Remember, recall, and forget long-term memories in sepiace",
} as const;

function createMemoryToolDefinition(
  service: memoryTypes.MemoryService,
): extensionsTypesTypes.ToolDefinition<typeof memorySchema, undefined> {
  return {
    description:
      "Long-term memory shared across sessions, kept by sepiace. Pass one natural-language request to remember a durable fact about the user or their decisions, to recall what is relevant before acting, or to forget what the user asks to forget. Name the repository when a fact belongs to one. Never include secrets.",
    execute: (_toolCallId, params, signal) =>
      service.send(params.request, signal).then((text) => ({
        content: [{ text: text === "" ? NOTHING : text, type: "text" }],
        details: undefined,
      })),
    label: "memory",
    name: "memory",
    parameters: memorySchema,
    promptGuidelines: [...memoryToolSystemPromptContribution.guidelines],
    promptSnippet: memoryToolSystemPromptContribution.snippet,
  };
}

const memory = { createMemoryToolDefinition };

export default memory;
