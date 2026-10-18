import type { Model, TranscriptContext } from "../types.ts";
import { getSystemMessageText } from "../utils/text.ts";
import {
  getDeclaredTools,
  getInitialSystemMessage,
  resolveTranscriptTools,
} from "../utils/transcript.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import {
  CODEX_TOOL_CALL_PROVIDERS,
  type CodexRequestBody,
  type OpenAICodexResponsesOptions,
} from "./openai-codex-options.ts";
import { convertResponsesMessages } from "./openai-responses-messages.ts";
import { convertResponsesTools } from "./openai-responses-tools.ts";

type CodexModel = Model<"openai-codex-responses">;

export function codexGrammarProperties(
  model: CodexModel,
): (context: TranscriptContext) => ReadonlyMap<string, string> {
  return (context) =>
    createGrammarToolInputProperties(
      getDeclaredTools(context.messages),
      model.compat?.supportsOpenAIGrammarTools ?? false,
    );
}

function requestedEffort(
  model: CodexModel,
  effort: NonNullable<OpenAICodexResponsesOptions["reasoningEffort"]>,
): string | null {
  if (effort !== "none") return model.thinkingLevelMap?.[effort] ?? effort;
  const off = model.thinkingLevelMap?.off;
  return off === undefined ? "none" : off;
}

function codexReasoning(
  model: CodexModel,
  options: OpenAICodexResponsesOptions | undefined,
): Pick<CodexRequestBody, "reasoning"> {
  if (options?.reasoningEffort !== undefined) {
    const effort = requestedEffort(model, options.reasoningEffort);
    return effort === null
      ? {}
      : { reasoning: { effort, summary: options.reasoningSummary ?? "auto" } };
  }
  const off = model.thinkingLevelMap?.off;
  return model.reasoning && off !== null ? { reasoning: { effort: off ?? "none" } } : {};
}

function instructionsOf(context: TranscriptContext): string {
  const initial = getInitialSystemMessage(context.messages);
  const text = initial === undefined ? "" : getSystemMessageText(initial);
  return text || "You are a helpful assistant.";
}

function codexInput(
  model: CodexModel,
  context: TranscriptContext,
  grammarToolInputProperties: ReadonlyMap<string, string>,
): { input: NonNullable<CodexRequestBody["input"]>; tools: CodexRequestBody["tools"] } {
  const compat = model.compat;
  const supportsAdditionalTools = compat?.supportsAdditionalTools ?? false;
  const supportsToolSearch = compat?.supportsToolSearch ?? false;
  const toolOptions = {
    strict: null,
    supportsStrictMode: compat?.supportsStrictMode ?? true,
    supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? false,
  };
  const input = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
    includeSystemPrompt: false,
    grammarToolInputProperties,
    supportsMidConvoSystemMessages: compat?.supportsMidConvoSystemMessages ?? false,
    supportsAdditionalTools,
    supportsToolSearch,
    toolOptions,
  });
  const { requestTools } = resolveTranscriptTools(
    context.messages,
    supportsAdditionalTools || supportsToolSearch,
  );
  return {
    input,
    tools: requestTools.length > 0 ? convertResponsesTools(requestTools, toolOptions) : undefined,
  };
}

export interface CodexBodyRequest {
  readonly model: CodexModel;
  readonly context: TranscriptContext;
  readonly options: OpenAICodexResponsesOptions | undefined;
  readonly cacheSessionId: string | undefined;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
}

export function buildCodexRequestBody({
  model,
  context,
  options,
  cacheSessionId,
  grammarToolInputProperties,
}: CodexBodyRequest): CodexRequestBody {
  const { input, tools } = codexInput(model, context, grammarToolInputProperties);
  return {
    model: model.id,
    store: false,
    stream: true,
    instructions: instructionsOf(context),
    input,
    text: { verbosity: options?.textVerbosity || "low" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: cacheSessionId,
    tool_choice: options?.toolChoice ?? "auto",
    parallel_tool_calls: true,
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options?.serviceTier === undefined ? {} : { service_tier: options.serviceTier }),
    ...(tools === undefined ? {} : { tools }),
    ...codexReasoning(model, options),
  };
}
