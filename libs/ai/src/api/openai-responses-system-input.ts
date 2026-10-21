import type { ResponseInput } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import hash from "../utils/hash.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import textModule from "../utils/text.ts";
import type openaiResponsesSystemInputTypes from "./openai-responses-system-input.types.ts";
import openaiResponsesTools from "./openai-responses-tools.ts";

const { convertResponsesTools } = openaiResponsesTools;
const { shortHash } = hash;
const { getSystemMessageText, renderSystemMessageUpdate } = textModule;
const { sanitizeSurrogates } = sanitizeUnicode;

function systemToolAdditions<TApi extends typesModule.Api>(
  { options, anchorsAdditions }: openaiResponsesSystemInputTypes.ConversionScope<TApi>,
  message: typesModule.SystemMessage,
  seed: string,
): ResponseInput {
  const tools = anchorsAdditions ? (message.toolsAdded ?? []) : [];
  if (tools.length === 0) return [];
  if (options?.supportsAdditionalTools === true) {
    const converted = convertResponsesTools(tools, options.toolOptions);
    return [{ role: "developer", tools: converted, type: "additional_tools" }];
  }
  if (options?.supportsToolSearch !== true) return [];
  const names = tools.map((tool) => tool.name);
  const callId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;
  const status = { call_id: callId, execution: "client", status: "completed" } as const;
  return [
    {
      type: "tool_search_call",
      ...status,
      arguments: { limit: names.length, query: names.join(" ") },
    },
    {
      type: "tool_search_output",
      ...status,
      tools: convertResponsesTools(tools, { ...options.toolOptions, toolSearchResult: true }),
    },
  ];
}

function convertSystemMessage<TApi extends typesModule.Api>({
  scope,
  message,
  position: { leading, msgIndex },
}: openaiResponsesSystemInputTypes.SystemConversion<TApi>): ResponseInput {
  if (leading && scope.options?.includeSystemPrompt === false) return [];
  const additions = leading ? [] : systemToolAdditions(scope, message, `system:${msgIndex}`);
  const text = leading ? getSystemMessageText(message) : renderSystemMessageUpdate(message);
  if (text.length === 0) return additions;
  return [...additions, { content: sanitizeSurrogates(text), role: scope.instructionRole }];
}

const openaiResponsesSystemInput = {
  convertSystemMessage,
};

export default openaiResponsesSystemInput;
