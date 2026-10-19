import { existsSync } from "node:fs";

import {
  createProvider,
  type AssistantMessageEventStream,
  type Model,
  type Provider,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@msa/ai";

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
    model: Model<string>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
}): Provider {
  const api = input.id;
  return createProvider({
    id: input.id,
    name: input.name,
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
    models: input.models.map((model) => ({
      ...model,
      api,
      provider: input.id,
      baseUrl: "",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
    api: {
      stream: (model, context, options) => input.streamSimple(model, context, options),
      streamSimple: (model, context, options) => input.streamSimple(model, context, options),
    },
  });
}
