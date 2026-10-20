import agentModule from "@msa/agent-core";
import ai from "@msa/ai";
import anthropic from "@msa/ai/providers/anthropic";

const { createModels } = ai;
const { anthropicProvider } = anthropic;

const { Agent } = agentModule;

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel("anthropic-api", "claude-sonnet-4-5");
if (model === undefined) throw new Error("Anthropic smoke-test model not found");

const agent = new Agent({
  initialState: { model },
  streamFn: models.streamSimple.bind(models),
});

const agentTreeshakeSmokeEntry = {
  agent,
};

export default agentTreeshakeSmokeEntry;
