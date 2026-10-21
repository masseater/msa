import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import { afterEach } from "vite-plus/test";

import agent from "../../src/index.ts";
import type agentTypes from "../../src/index.types.ts";
import type fauxTypes from "./faux.types.ts";

const { registerFauxProvider, streamSimple } = compat;

const { Agent } = agent;

const useFaux = (): ((options?: fauxTypes.FauxOptions) => compatTypes.FauxProviderRegistration) => {
  const registrations: compatTypes.FauxProviderRegistration[] = [];
  afterEach(() => {
    while (registrations.length > 0) registrations.pop()?.unregister();
  });
  return (options = {}) => {
    const registration = registerFauxProvider(options);
    registrations.push(registration);
    return registration;
  };
};

const textOf = (message: compatTypes.AssistantMessage | compatTypes.ToolResultMessage): string =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const fauxAgent = (
  initialState: agentTypes.AgentInitialState & { model: compatTypes.Model<string> },
): agentTypes.Agent =>
  new Agent({
    initialState: {
      systemPrompt: "You are a helpful assistant.",
      thinkingLevel: "off",
      tools: [],
      ...initialState,
    },
    streamFn: streamSimple,
  });

const expectAssistant = (message: unknown): compatTypes.AssistantMessage => {
  const assistant = message as compatTypes.AssistantMessage | undefined;
  if (assistant?.role !== "assistant") throw new Error("Expected assistant message");
  return assistant;
};

const faux = {
  expectAssistant,
  fauxAgent,
  textOf,
  useFaux,
};

export default faux;
