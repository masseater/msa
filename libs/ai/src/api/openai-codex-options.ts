import type {
  Tool as OpenAITool,
  ResponseCreateParamsStreaming,
  ResponseInput,
} from "openai/resources/responses/responses.js";

import type { StreamOptions } from "../types.ts";

export const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

export interface OpenAICodexResponsesOptions extends StreamOptions {
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null | undefined;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"] | undefined;
  textVerbosity?: "low" | "medium" | "high" | undefined;
  toolChoice?: "auto" | "none" | "required" | undefined;
}

export interface CodexRequestBody {
  model: string;
  store?: boolean;
  stream?: boolean;
  instructions?: string;
  previous_response_id?: string;
  input?: ResponseInput;
  tools?: OpenAITool[];
  tool_choice?: OpenAICodexResponsesOptions["toolChoice"];
  parallel_tool_calls?: boolean;
  temperature?: number;
  reasoning?: { effort?: string; summary?: string };
  service_tier?: ResponseCreateParamsStreaming["service_tier"];
  text?: { verbosity?: string };
  include?: string[];
  prompt_cache_key?: string | undefined;
  [key: string]: unknown;
}
