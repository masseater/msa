const OPENAI_COMPLETIONS_REASONING_FIELDS = [
  "reasoning",
  "reasoning_content",
  "reasoning_text",
] as const;

const openaiCompletionsTypes = {
  OPENAI_COMPLETIONS_REASONING_FIELDS,
};

export default openaiCompletionsTypes;
