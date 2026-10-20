import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import nodeFs from "../platform/node/fs.ts";
import type providerTypes from "./provider.types.ts";

const { existsSync } = nodeFs;

const { createProvider } = ai;

function cliAgentProvider(input: {
  id: string;
  name: string;
  models: readonly providerTypes.CliAgentModel[];

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
        resolve: () => {
          const executable = input.executable();
          return Promise.resolve(
            executable !== undefined && executable !== "" && existsSync(executable)
              ? { auth: {}, source: executable }
              : undefined,
          );
        },
      },
    },
    id: input.id,
    models: input.models.map((model) => ({
      ...model,
      api,
      baseUrl: "",
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      provider: input.id,
    })),
    name: input.name,
  });
}

const provider = {
  cliAgentProvider,
};

export default provider;
