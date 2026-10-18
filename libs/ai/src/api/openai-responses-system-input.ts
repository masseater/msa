import type { ResponseInput } from "openai/resources/responses/responses.js";

import type { Api, Model, SystemMessage } from "../types.ts";
import { shortHash } from "../utils/hash.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText, renderSystemMessageUpdate } from "../utils/text.ts";
import type { ConvertResponsesMessagesOptions } from "./openai-responses-options.ts";
import { convertResponsesTools } from "./openai-responses-tools.ts";

export interface ConversionScope<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly options: ConvertResponsesMessagesOptions | undefined;
  readonly instructionRole: "developer" | "system";
  readonly anchorsAdditions: boolean;
}

function systemToolAdditions<TApi extends Api>(
  { options, anchorsAdditions }: ConversionScope<TApi>,
  message: SystemMessage,
  seed: string,
): ResponseInput {
  const tools = anchorsAdditions ? (message.toolsAdded ?? []) : [];
  if (tools.length === 0) return [];
  if (options?.supportsAdditionalTools === true) {
    const converted = convertResponsesTools(tools, options.toolOptions);
    return [{ type: "additional_tools", role: "developer", tools: converted }];
  }
  if (options?.supportsToolSearch !== true) return [];
  const names = tools.map((tool) => tool.name);
  const callId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;
  const status = { call_id: callId, execution: "client", status: "completed" } as const;
  return [
    {
      type: "tool_search_call",
      ...status,
      arguments: { query: names.join(" "), limit: names.length },
    },
    {
      type: "tool_search_output",
      ...status,
      tools: convertResponsesTools(tools, { ...options.toolOptions, toolSearchResult: true }),
    },
  ];
}

export interface Position {
  readonly leading: boolean;
  readonly msgIndex: number;
}

export interface SystemConversion<TApi extends Api> {
  readonly scope: ConversionScope<TApi>;
  readonly message: SystemMessage;
  readonly position: Position;
}

export function convertSystemMessage<TApi extends Api>({
  scope,
  message,
  position: { leading, msgIndex },
}: SystemConversion<TApi>): ResponseInput {
  if (leading && scope.options?.includeSystemPrompt === false) return [];
  const additions = leading ? [] : systemToolAdditions(scope, message, `system:${msgIndex}`);
  const text = leading ? getSystemMessageText(message) : renderSystemMessageUpdate(message);
  if (text.length === 0) return additions;
  return [...additions, { role: scope.instructionRole, content: sanitizeSurrogates(text) }];
}
