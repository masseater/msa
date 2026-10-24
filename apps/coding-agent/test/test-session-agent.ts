import agent from "@msa/agent-core";
import compat from "@msa/ai/compat";

import src from "../src/index.ts";
import type utilitiesTypes from "./utilities.types.ts";

const { createCodingTools } = src;

const { getModel, streamSimple } = compat;

const { Agent } = agent;

const createAgent = (options: utilitiesTypes.TestSessionOptions) =>
  new Agent({
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
