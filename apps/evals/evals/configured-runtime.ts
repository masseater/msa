import * as NodePath from "@effect/platform-node/NodePath";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Cause, Effect, Exit, Function, ManagedRuntime, Path } from "effect";

import type configuredRuntimeTypes from "./configured-runtime.types.ts";

const { ModelRuntime } = codingAgent;

const { contentText } = ai;

function modelFields(model: aiTypes.Model<aiTypes.Api>): configuredRuntimeTypes.ModelFields {
  return {
    contextWindow: model.contextWindow,
    cost: {
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
      input: model.cost.input,
      output: model.cost.output,
    },
    id: model.id,
    input: [...model.input],
    maxTokens: model.maxTokens,
    name: model.name,
    provider: model.provider,
    reasoning: model.reasoning,
  };
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const nodePath = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

const loadConfiguredModelRuntime = (
  agentDir: string,
): Effect.Effect<codingAgentTypes.ModelRuntime> =>
  Effect.promise(() =>
    ModelRuntime.create({
      allowModelNetwork: false,
      authPath: nodePath.join(agentDir, "auth.json"),
      modelsPath: nodePath.join(agentDir, "models.json"),
      modelsStorePath: nodePath.join(agentDir, "models-store.json"),
    }),
  );

const failure = (error: string): { result: { error: string } } => ({ result: { error } });

const completeProbe = (
  runtime: codingAgentTypes.ModelRuntime,
  scenario: configuredRuntimeTypes.ProviderScenario,
  model: aiTypes.Model<aiTypes.Api>,
): Effect.Effect<configuredRuntimeTypes.ProviderRuntimeOutput> =>
  Effect.promise(() =>
    runtime.completeSimple(model, scenario.createContext(), scenario.options),
  ).pipe(
    Effect.exit,
    Effect.map((exit) =>
      Exit.isFailure(exit)
        ? failure(errorMessage(Cause.squash(exit.cause)))
        : {
            result: {
              model: modelFields(model),
              response: {
                inputTokens: exit.value.usage.input,
                outputTokens: exit.value.usage.output,
                stopReason: exit.value.stopReason,
                text: contentText(exit.value.content, "\n"),
              },
              validRequestReceived: scenario.validRequestReceived(),
            },
          },
    ),
  );

const inspectProvider: {
  (
    scenario: configuredRuntimeTypes.ProviderScenario,
  ): (
    runtime: codingAgentTypes.ModelRuntime,
  ) => Effect.Effect<configuredRuntimeTypes.ProviderRuntimeOutput>;
  (
    runtime: codingAgentTypes.ModelRuntime,
    scenario: configuredRuntimeTypes.ProviderScenario,
  ): Effect.Effect<configuredRuntimeTypes.ProviderRuntimeOutput>;
} = Function.dual(
  2,
  (
    runtime: codingAgentTypes.ModelRuntime,
    scenario: configuredRuntimeTypes.ProviderScenario,
  ): Effect.Effect<configuredRuntimeTypes.ProviderRuntimeOutput> =>
    Effect.gen(function* () {
      yield* Effect.promise(() => runtime.refresh({ allowNetwork: false }));
      const configurationError = runtime.getError();
      if (configurationError !== undefined && configurationError !== "") {
        return failure(configurationError);
      }
      const model = runtime.getModel(scenario.providerId, scenario.modelId);
      if (model === undefined) {
        return failure(
          `Model ${scenario.providerId}/${scenario.modelId} is unavailable after reload.`,
        );
      }
      return yield* completeProbe(runtime, scenario, model);
    }),
);

const inspectAddedModel: {
  (
    providerId: string,
    modelId: string,
  ): (
    runtime: codingAgentTypes.ModelRuntime,
  ) => Effect.Effect<configuredRuntimeTypes.AddedModelOutput>;
  (
    runtime: codingAgentTypes.ModelRuntime,
    providerId: string,
    modelId: string,
  ): Effect.Effect<configuredRuntimeTypes.AddedModelOutput>;
} = Function.dual(
  3,
  (
    runtime: codingAgentTypes.ModelRuntime,
    providerId: string,
    modelId: string,
  ): Effect.Effect<configuredRuntimeTypes.AddedModelOutput> =>
    Effect.gen(function* () {
      const pristineRuntime = yield* Effect.promise(() =>
        ModelRuntime.create({ allowModelNetwork: false, modelsPath: null }),
      );
      const pristineProvider = pristineRuntime.getProvider(providerId);
      if (pristineProvider === undefined) {
        return failure(`Built-in provider ${providerId} is unavailable.`);
      }
      const existingModelIds = pristineProvider.getModels().map(({ id }) => id);
      if (existingModelIds.length === 0) {
        return failure(`Built-in provider ${providerId} has no models.`);
      }
      yield* Effect.promise(() => runtime.refresh({ allowNetwork: false }));
      const configurationError = runtime.getError();
      if (configurationError !== undefined && configurationError !== "") {
        return failure(configurationError);
      }
      const model = runtime.getModel(providerId, modelId);
      if (model === undefined) {
        return failure(`Model ${providerId}/${modelId} is unavailable after reload.`);
      }
      return {
        result: {
          existingModelsPreserved: existingModelIds.every(
            (id) => runtime.getModel(providerId, id) !== undefined,
          ),
          model: modelFields(model),
        },
      };
    }),
);

const configuredRuntime = {
  inspectAddedModel,
  inspectProvider,
  loadConfiguredModelRuntime,
};

export default configuredRuntime;
