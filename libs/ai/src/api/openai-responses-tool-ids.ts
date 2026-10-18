import type { Api, AssistantMessage, Model } from "../types.ts";
import { shortHash } from "../utils/hash.ts";
import type { ToolCallIdNormalizer } from "./transform-messages.ts";

const MAX_ID_LENGTH = 64;

function normalizeIdPart(part: string): string {
  const sanitized = part.replace(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length));
  return sanitized.slice(0, MAX_ID_LENGTH).replace(/_+$/u, "");
}

const foreignItemId = (itemId: string): string => `fc_${shortHash(itemId)}`.slice(0, MAX_ID_LENGTH);

function normalizeItemId(itemId: string, foreign: boolean): string {
  const normalized = foreign ? foreignItemId(itemId) : normalizeIdPart(itemId);
  return normalized.startsWith("fc_") ? normalized : normalizeIdPart(`fc_${normalized}`);
}

export interface ToolCallIdScope<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly allowedToolCallProviders: ReadonlySet<string>;
}

export function responsesToolCallIdNormalizer<TApi extends Api>({
  model,
  allowedToolCallProviders,
}: ToolCallIdScope<TApi>): ToolCallIdNormalizer<TApi> {
  return (id: string, _targetModel: Model<TApi>, source: AssistantMessage): string => {
    if (!allowedToolCallProviders.has(model.provider) || !id.includes("|")) {
      return normalizeIdPart(id);
    }
    const [callId = "", itemId = ""] = id.split("|");
    const foreign = source.provider !== model.provider || source.api !== model.api;
    return `${normalizeIdPart(callId)}|${normalizeItemId(itemId, foreign)}`;
  };
}
