import agentModule from "@msa/agent-core";
import ai from "@msa/ai";
import compat from "@msa/ai/compat";
import chord from "@msa/chord";

const { complete, getModels, getProviders, streamSimple } = compat;
const { Type, createAssistantMessageEventStream } = ai;

const { Agent, streamProxy } = agentModule;

const { createHost, memoryLinkPair, replicatedState } = chord;

const model = getModels("openai").find((candidate) => candidate.api === "openai-responses");
const schema = Type.Object({ prompt: Type.String() });
const stream = createAssistantMessageEventStream();

const agent = new Agent({
  initialState: model === undefined ? {} : { model },
  streamFn: streamSimple,
});
agent.steer({ content: [{ text: "queued", type: "text" }], role: "user", timestamp: 0 });

const liveBindings = [
  model?.id,
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

export default liveBindings;
