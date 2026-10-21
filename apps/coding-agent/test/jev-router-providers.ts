import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

const { createProvider, fauxProvider } = ai;

const { awaited, currentTimeMillis, runTest } = testing;

function createTool(name: string, fails = false): agentTypes.AgentTool {
  return {
    description: `Fake ${name} tool`,
    execute: () =>
      runTest(
        Effect.gen(function* () {
          if (fails) throw new Error(`${name} failed`);
          return yield* awaited({
            content: [{ text: `${name} ok`, type: "text" as const }],
            details: {},
          });
        }),
      ),
    label: name,
    name,
    parameters: Type.Object({ path: Type.String() }),
  };
}

const jevModel: aiTypes.ClassifierModel<string> = {
  api: "typesafe-system-one" as const,
  baseUrl: "",
  contextWindow: 64_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "~typesafe/jev-latest",
  input: ["text"],
  name: "Jev",
  provider: "openrouter",
  type: "classifier" as const,
};

const createRouterProviders = (input: { readonly complex: number }) =>
  Effect.gen(function* () {
    const { complex } = input;
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const codex = fauxProvider({
      models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].map((id) => ({
        id,
        reasoning: true,
      })),
      provider: "openai-codex",
    });
    const openrouter = createProvider({
      auth: {
        apiKey: { name: "OpenRouter", resolve: () => effectRunPromise(awaited({ auth: {} })) },
      },
      classifiers: {
        "typesafe-system-one": {
          classify: (model) =>
            effectRunPromise(
              awaited({
                answers: {
                  complexity: {
                    choice: complex >= 0.5 ? "complex" : "standard",
                    confidence: Math.max(complex, 1 - complex),
                    probabilities: { complex, standard: 1 - complex },
                    type: "choice" as const,
                  },
                },
                api: model.api,
                model: model.id,
                provider: model.provider,
                stopReason: "stop",
                timestamp: currentTimeMillis(),
              }),
            ),
        },
      },
      id: "openrouter",
      models: [jevModel],
    });
    return { codex, openrouter };
  });

const jevRouterProviders = { createRouterProviders, createTool };

export default jevRouterProviders;
