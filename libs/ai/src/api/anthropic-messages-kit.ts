import eventStream from "../utils/event-stream.ts";
import modelCall from "../utils/model-call.ts";
import transcript from "../utils/transcript.ts";
import anthropicMessagesClient from "./anthropic-messages-client.ts";
import anthropicMessagesCompat from "./anthropic-messages-compat.ts";

const anthropicMessagesKit = {
  anthropicMessagesClient,
  anthropicMessagesCompat,
  eventStream,
  modelCall,
  transcript,
};

export default anthropicMessagesKit;
