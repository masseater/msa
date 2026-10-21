import type {
  Tool as OpenAITool,
  ResponseCreateParamsStreaming,
  ResponseInput,
} from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";

declare namespace openaiCodexOptionsTypes {
  interface OpenAICodexResponsesOptions extends typesModule.StreamOptions {
    reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
    reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null | undefined;
    serviceTier?: ResponseCreateParamsStreaming["service_tier"] | undefined;
    textVerbosity?: "low" | "medium" | "high" | undefined;
    toolChoice?: "auto" | "none" | "required" | undefined;
  }

  interface CodexRequestBody {
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
}

export type { openaiCodexOptionsTypes as default };
