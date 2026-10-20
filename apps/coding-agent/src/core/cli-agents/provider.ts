import { existsSync } from "node:fs";

import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

const { createProvider } = ai;

export interface CliAgentModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

export function cliAgentProvider(input: {
  id: string;
  name: string;
  models: readonly CliAgentModel[];

  executable(): string | undefined;
  streamSimple(
    model: aiTypes.Model<string>,
    context: aiTypes.TranscriptContext,
    options?: aiTypes.SimpleStreamOptions,
  ): aiTypes.AssistantMessageEventStream;
}): aiTypes.Provider {
  const api = input.id;
  return createProvider({
    api: {
      stream: (model, context, options) => input.streamSimple(model, context, options),
      streamSimple: (model, context, options) => input.streamSimple(model, context, options),
    },
    auth: {
      apiKey: {
        name: `${input.name} login`,
        resolve: async () => {
          const executable = input.executable();
          return executable && existsSync(executable)
            ? { auth: {}, source: executable }
            : undefined;
        },
      },
    },
    id: input.id,
    models: input.models.map((model) => ({
      ...model,
      api,
      provider: input.id,
      baseUrl: "",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
    name: input.name,
  });
}
