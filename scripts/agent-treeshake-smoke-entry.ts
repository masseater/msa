import { Agent } from "@msa/agent-core";
import { createModels } from "@msa/ai";
import { anthropicProvider } from "@msa/ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel("anthropic-api", "claude-sonnet-4-5");
if (model === undefined) throw new Error("Anthropic smoke-test model not found");

export const agent = new Agent({
  initialState: { model },
  streamFn: models.streamSimple.bind(models),
});
