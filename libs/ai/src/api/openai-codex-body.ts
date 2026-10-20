import type typesModule from "../types.types.ts";
import textModule from "../utils/text.ts";
import transcript from "../utils/transcript.ts";
import constrainedSampling from "./constrained-sampling.ts";
import type openaiCodexBodyTypes from "./openai-codex-body.types.ts";
import openaiCodexOptions from "./openai-codex-options.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";
import openaiResponsesMessages from "./openai-responses-messages.ts";
import openaiResponsesTools from "./openai-responses-tools.ts";

const { createGrammarToolInputProperties } = constrainedSampling;
const { getDeclaredTools, getInitialSystemMessage, resolveTranscriptTools } = transcript;
const { getSystemMessageText } = textModule;
const { convertResponsesMessages } = openaiResponsesMessages;
const { CODEX_TOOL_CALL_PROVIDERS } = openaiCodexOptions;
const { convertResponsesTools } = openaiResponsesTools;

function codexGrammarProperties(
  model: openaiCodexBodyTypes.CodexModel,
): (context: typesModule.TranscriptContext) => ReadonlyMap<string, string> {
  return (context) =>
    createGrammarToolInputProperties(
      getDeclaredTools(context.messages),
      model.compat?.supportsOpenAIGrammarTools ?? false,
    );
}

function requestedEffort(
  model: openaiCodexBodyTypes.CodexModel,
  effort: NonNullable<openaiCodexOptionsTypes.OpenAICodexResponsesOptions["reasoningEffort"]>,
): string | null {
  if (effort !== "none") return model.thinkingLevelMap?.[effort] ?? effort;
  const off = model.thinkingLevelMap?.off;
  return off === undefined ? "none" : off;
}

function codexReasoning(
  model: openaiCodexBodyTypes.CodexModel,
  options: openaiCodexOptionsTypes.OpenAICodexResponsesOptions | undefined,
): Pick<openaiCodexOptionsTypes.CodexRequestBody, "reasoning"> {
  if (options?.reasoningEffort !== undefined) {
    const effort = requestedEffort(model, options.reasoningEffort);
    return effort === null
      ? {}
      : { reasoning: { effort, summary: options.reasoningSummary ?? "auto" } };
  }
  const off = model.thinkingLevelMap?.off;
  return model.reasoning && off !== null ? { reasoning: { effort: off ?? "none" } } : {};
}

function instructionsOf(context: typesModule.TranscriptContext): string {
  const initial = getInitialSystemMessage(context.messages);
  const text = initial === undefined ? "" : getSystemMessageText(initial);
  return text || "You are a helpful assistant.";
}

function codexInput(
  model: openaiCodexBodyTypes.CodexModel,
  context: typesModule.TranscriptContext,
  grammarToolInputProperties: ReadonlyMap<string, string>,
): {
  input: NonNullable<openaiCodexOptionsTypes.CodexRequestBody["input"]>;
  tools: openaiCodexOptionsTypes.CodexRequestBody["tools"];
} {
  const compat = model.compat;
  const supportsAdditionalTools = compat?.supportsAdditionalTools ?? false;
  const supportsToolSearch = compat?.supportsToolSearch ?? false;
  const toolOptions = {
    strict: null,
    supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? false,
    supportsStrictMode: compat?.supportsStrictMode ?? true,
  };
  const input = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
    grammarToolInputProperties,
    includeSystemPrompt: false,
    supportsAdditionalTools,
    supportsMidConvoSystemMessages: compat?.supportsMidConvoSystemMessages ?? false,
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

function buildCodexRequestBody({
  model,
  context,
  options,
  cacheSessionId,
  grammarToolInputProperties,
}: openaiCodexBodyTypes.CodexBodyRequest): openaiCodexOptionsTypes.CodexRequestBody {
  const { input, tools } = codexInput(model, context, grammarToolInputProperties);
  return {
    include: ["reasoning.encrypted_content"],
    input,
    instructions: instructionsOf(context),
    model: model.id,
    parallel_tool_calls: true,
    prompt_cache_key: cacheSessionId,
    store: false,
    stream: true,
    text: { verbosity: options?.textVerbosity || "low" },
    tool_choice: options?.toolChoice ?? "auto",
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options?.serviceTier === undefined ? {} : { service_tier: options.serviceTier }),
    ...(tools === undefined ? {} : { tools }),
    ...codexReasoning(model, options),
  };
}

const openaiCodexBody = {
  buildCodexRequestBody,
  codexGrammarProperties,
};

export default openaiCodexBody;
