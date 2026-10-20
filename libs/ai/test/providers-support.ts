import faux from "../src/providers/faux.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import eventStream from "../src/utils/event-stream.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { currentTimeMillis } = clock;
const { AssistantMessageEventStream } = eventStream;
const { fauxAssistantMessage } = faux;

const context = normalizeContext({
  messages: [{ content: "hi", role: "user", timestamp: currentTimeMillis() }],
});

function recordingStreams(label: string, calls: string[]): typesModule.ProviderStreams {
  const respond = (model: typesModule.Model<typesModule.Api>) => {
    calls.push(`${label}:${model.id}`);
    const stream = new AssistantMessageEventStream();
    const message = fauxAssistantMessage("ok");
    stream.push({ partial: message, type: "start" });
    stream.push({ message, reason: "stop", type: "done" });
    stream.end(message);
    return stream;
  };
  return { stream: respond, streamSimple: respond };
}

const testModel = (api: string, id: string): typesModule.Model<typesModule.Api> => ({
  api,
  baseUrl: "https://example.test/v1",
  contextWindow: 10000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id,
  input: ["text"],
  maxTokens: 1000,
  name: id,
  provider: "mixed",
  reasoning: false,
});

const providersSupport = {
  context,
  recordingStreams,
  testModel,
};

export default providersSupport;
