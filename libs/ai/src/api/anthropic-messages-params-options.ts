import type {
  BetaCacheControlEphemeral as CacheControlEphemeral,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";

const { sanitizeSurrogates } = sanitizeUnicode;

interface BuildSystemInput {
  readonly initialSystemText: string;
  readonly cacheControl: CacheControlEphemeral | undefined;
}

function buildSystem(
  input: BuildSystemInput,
): NonNullable<MessageCreateParamsStreaming["system"]> | undefined {
  const { initialSystemText, cacheControl } = input;
  if (initialSystemText === "") return undefined;
  const cache = cacheControl === undefined ? {} : { cache_control: cacheControl };
  return [{ text: sanitizeSurrogates(initialSystemText), type: "text", ...cache }];
}

function applyMetadata(input: {
  options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
  params: MessageCreateParamsStreaming;
}): void {
  const { options, params } = input;
  if (options?.metadata === undefined) return;
  const userId = options.metadata["user_id"];
  if (typeof userId === "string") {
    params.metadata = { user_id: userId };
  }
}

function applyToolChoice(input: {
  options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
  params: MessageCreateParamsStreaming;
}): void {
  const { options, params } = input;
  if (options?.toolChoice === undefined) return;
  params.tool_choice =
    typeof options.toolChoice === "string" ? { type: options.toolChoice } : options.toolChoice;
}

function applyFallbacks(input: {
  model: typesModule.Model<"anthropic-messages">;
  params: MessageCreateParamsStreaming;
}): void {
  const { model, params } = input;
  const allowedFallbackModels = model.compat?.allowedFallbackModels;
  if (allowedFallbackModels === undefined || allowedFallbackModels.length === 0) return;
  params.fallbacks = allowedFallbackModels.map((fallback) => ({ model: fallback.model }));
}

interface ParamsOptionsInput {
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
  readonly params: MessageCreateParamsStreaming;
}

function applyParamsOptions(input: ParamsOptionsInput): void {
  applyMetadata(input);
  applyToolChoice(input);
  applyFallbacks(input);
}

const anthropicMessagesParamsOptions = {
  applyParamsOptions,
  buildSystem,
};

export default anthropicMessagesParamsOptions;
