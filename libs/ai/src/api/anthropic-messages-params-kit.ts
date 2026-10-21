import text from "../utils/text.ts";
import transcript from "../utils/transcript.ts";
import anthropicMessagesCompat from "./anthropic-messages-compat.ts";
import anthropicMessagesConvert from "./anthropic-messages-convert.ts";

const anthropicMessagesParamsKit = {
  anthropicMessagesCompat,
  anthropicMessagesConvert,
  text,
  transcript,
};

export default anthropicMessagesParamsKit;
