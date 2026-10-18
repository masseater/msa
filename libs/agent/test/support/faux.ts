import {
  type AssistantMessage,
  type FauxProviderRegistration,
  type Model,
  registerFauxProvider,
  streamSimple,
  type ToolResultMessage,
} from "@msa/ai/compat";
import { afterEach } from "vite-plus/test";

import { Agent, type AgentInitialState } from "../../src/index.ts";

export type FauxOptions = Parameters<typeof registerFauxProvider>[0];

export const useFaux = (): ((options?: FauxOptions) => FauxProviderRegistration) => {
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

export const textOf = (message: AssistantMessage | ToolResultMessage): string =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

export const fauxAgent = (initialState: AgentInitialState & { model: Model<string> }): Agent =>
  new Agent({
    streamFn: streamSimple,
    initialState: {
      systemPrompt: "You are a helpful assistant.",
      thinkingLevel: "off",
      tools: [],
      ...initialState,
    },
  });

export const expectAssistant = (message: unknown): AssistantMessage => {
  const assistant = message as AssistantMessage | undefined;
  if (assistant?.role !== "assistant") throw new Error("Expected assistant message");
  return assistant;
};
