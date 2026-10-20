import transcript from "../utils/transcript.ts";
import openaiCompletionsAssistant from "./openai-completions-assistant.ts";
import openaiCompletionsConvertState from "./openai-completions-convert-state.ts";

const openaiCompletionsMessagesKit = {
  openaiCompletionsAssistant,
  openaiCompletionsConvertState,
  transcript,
};

export default openaiCompletionsMessagesKit;
