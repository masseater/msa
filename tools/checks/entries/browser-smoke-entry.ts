import { Agent, streamProxy } from "@msa/agent-core";
import { createAssistantMessageEventStream, Type } from "@msa/ai";
import { complete, getModel, getProviders, streamSimple } from "@msa/ai/compat";
import { createHost, memoryLinkPair, replicatedState } from "@msa/chord";

const model = getModel("openai", "gpt-5.5");
const schema = Type.Object({ prompt: Type.String() });
const stream = createAssistantMessageEventStream();

const agent = new Agent({ initialState: { model }, streamFn: streamSimple });
agent.steer({ role: "user", content: [{ type: "text", text: "queued" }], timestamp: 0 });

export const liveBindings = [
  model.id,
  getProviders().length,
  typeof complete,
  schema.type,
  typeof stream.push,
  agent.hasQueuedMessages(),
  typeof streamProxy,
  typeof createHost,
  typeof memoryLinkPair,
  replicatedState({ browser: true }).value.browser,
];
