import {
  type AssistantMessage,
  type FauxProviderRegistration,
  type Model,
  type ToolResultMessage,
  registerFauxProvider,
  streamSimple,
} from "@msa/ai/compat";
import { afterEach } from "vite-plus/test";

import { Agent, type AgentInitialState } from "../../src/index.ts";
import type fauxTypes from "./faux.types.ts";

const useFaux = (): ((options?: fauxTypes.FauxOptions) => FauxProviderRegistration) => {
  const registrations: FauxProviderRegistration[] = [];
  afterEach(() => {
    while (registrations.length > 0) registrations.pop()?.unregister();
  });
  return (options = {}) => {
    const registration = registerFauxProvider(options);
    registrations.push(registration);
    return registration;
  };
};

const textOf = (message: AssistantMessage | ToolResultMessage): string =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const fauxAgent = (initialState: AgentInitialState & { model: Model<string> }): Agent =>
  new Agent({
    initialState: {
      systemPrompt: "You are a helpful assistant.",
      thinkingLevel: "off",
      tools: [],
      ...initialState,
    },
    streamFn: streamSimple,
  });

const expectAssistant = (message: unknown): AssistantMessage => {
  const assistant = message as AssistantMessage | undefined;
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
