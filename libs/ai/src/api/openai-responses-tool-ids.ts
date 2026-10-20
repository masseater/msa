import type typesModule from "../types.types.ts";
import hash from "../utils/hash.ts";
import type openaiResponsesToolIdsTypes from "./openai-responses-tool-ids.types.ts";
import type transformMessagesTypes from "./transform-messages.types.ts";

const { shortHash } = hash;

const MAX_ID_LENGTH = 64;

function normalizeIdPart(part: string): string {
  const sanitized = part.replaceAll(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length));
  return sanitized.slice(0, MAX_ID_LENGTH).replace(/_+$/u, "");
}

const foreignItemId = (itemId: string): string => `fc_${shortHash(itemId)}`.slice(0, MAX_ID_LENGTH);

function normalizeItemId(itemId: string, foreign: boolean): string {
  const normalized = foreign ? foreignItemId(itemId) : normalizeIdPart(itemId);
  return normalized.startsWith("fc_") ? normalized : normalizeIdPart(`fc_${normalized}`);
}

function responsesToolCallIdNormalizer<TApi extends typesModule.Api>({
  model,
  allowedToolCallProviders,
}: openaiResponsesToolIdsTypes.ToolCallIdScope<TApi>): transformMessagesTypes.ToolCallIdNormalizer<TApi> {
  return (
    id: string,
    _targetModel: typesModule.Model<TApi>,
    source: typesModule.AssistantMessage,
  ): string => {
    if (!allowedToolCallProviders.has(model.provider) || !id.includes("|")) {
      return normalizeIdPart(id);
    }
    const [callId = "", itemId = ""] = id.split("|");
    const foreign = source.provider !== model.provider || source.api !== model.api;
    return `${normalizeIdPart(callId)}|${normalizeItemId(itemId, foreign)}`;
  };
}

const openaiResponsesToolIds = {
  responsesToolCallIdNormalizer,
};

export default openaiResponsesToolIds;
