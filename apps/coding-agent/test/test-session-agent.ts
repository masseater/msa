import { Agent } from "@msa/agent-core";
import { getModel, streamSimple } from "@msa/ai/compat";

import { createCodingTools } from "../src/index.ts";
import utilities from "./utilities.ts";
import type utilitiesTypes from "./utilities.types.ts";

const { API_KEY } = utilities;

const createAgent = (options: utilitiesTypes.TestSessionOptions) =>
  new Agent({
    getApiKey: () => API_KEY,
    initialState: {
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      systemPrompt: options.systemPrompt ?? "You are a helpful assistant. Be extremely concise.",
      tools: createCodingTools(process.cwd()),
    },
    streamFn: streamSimple,
  });

const testSessionAgent = {
  createAgent,
};

export default testSessionAgent;
