import transcript from "../utils/transcript.ts";
import openaiCompletionsCache from "./openai-completions-cache.ts";
import simpleOptions from "./simple-options.ts";

const openaiCompletionsParamsKit = {
  openaiCompletionsCache,
  simpleOptions,
  transcript,
};

export default openaiCompletionsParamsKit;
