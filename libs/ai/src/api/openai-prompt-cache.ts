const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

function clampOpenAIPromptCacheKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const chars = Array.from(key);
  if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) return key;
  return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}

const openaiPromptCache = {
  OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
  clampOpenAIPromptCacheKey,
};

export default openaiPromptCache;
