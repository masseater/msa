import * as NodePath from "@effect/platform-node/NodePath";
import {
  type Api,
  type Context,
  contentText,
  type Model,
  type ModelsSimpleStreamOptions,
} from "@msa/ai";
import { ModelRuntime } from "@msa/coding-agent";
import { Cause, Effect, Exit, Function, ManagedRuntime, Path } from "effect";

type ModelFields = {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

export type ProviderRuntimeOutput = {
  result:
    | {
        validRequestReceived: boolean;
        model: ModelFields;
        response: { text: string; stopReason: string; inputTokens: number; outputTokens: number };
      }
    | { error: string };
};

export type AddedModelOutput = {
  result: { model: ModelFields; existingModelsPreserved: boolean } | { error: string };
};

export type ProviderScenario = {
  providerId: string;
  modelId: string;
  createContext(): Context;
  options?: ModelsSimpleStreamOptions;
  validRequestReceived(): boolean;
};

function modelFields(model: Model<Api>): ModelFields {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const nodePath = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

export const loadConfiguredModelRuntime = (agentDir: string): Effect.Effect<ModelRuntime> =>
  Effect.promise(() =>
    ModelRuntime.create({
      modelsPath: nodePath.join(agentDir, "models.json"),
      authPath: nodePath.join(agentDir, "auth.json"),
      modelsStorePath: nodePath.join(agentDir, "models-store.json"),
      allowModelNetwork: false,
    }),
  );

const failure = (error: string): { result: { error: string } } => ({ result: { error } });

const completeProbe = (
  runtime: ModelRuntime,
  scenario: ProviderScenario,
  model: Model<Api>,
): Effect.Effect<ProviderRuntimeOutput> =>
  Effect.promise(() =>
    runtime.completeSimple(model, scenario.createContext(), scenario.options),
  ).pipe(
    Effect.exit,
    Effect.map((exit) =>
      Exit.isFailure(exit)
        ? failure(errorMessage(Cause.squash(exit.cause)))
        : {
            result: {
              validRequestReceived: scenario.validRequestReceived(),
              model: modelFields(model),
              response: {
                text: contentText(exit.value.content, "\n"),
                stopReason: exit.value.stopReason,
                inputTokens: exit.value.usage.input,
                outputTokens: exit.value.usage.output,
              },
            },
          },
    ),
  );

export const inspectProvider: {
  (scenario: ProviderScenario): (runtime: ModelRuntime) => Effect.Effect<ProviderRuntimeOutput>;
  (runtime: ModelRuntime, scenario: ProviderScenario): Effect.Effect<ProviderRuntimeOutput>;
} = Function.dual(
  2,
  (runtime: ModelRuntime, scenario: ProviderScenario): Effect.Effect<ProviderRuntimeOutput> =>
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

export const inspectAddedModel: {
  (providerId: string, modelId: string): (runtime: ModelRuntime) => Effect.Effect<AddedModelOutput>;
  (runtime: ModelRuntime, providerId: string, modelId: string): Effect.Effect<AddedModelOutput>;
} = Function.dual(
  3,
  (runtime: ModelRuntime, providerId: string, modelId: string): Effect.Effect<AddedModelOutput> =>
    Effect.gen(function* () {
      const pristineRuntime = yield* Effect.promise(() =>
        ModelRuntime.create({ modelsPath: null, allowModelNetwork: false }),
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
          model: modelFields(model),
          existingModelsPreserved: existingModelIds.every(
            (id) => runtime.getModel(providerId, id) !== undefined,
          ),
        },
      };
    }),
);
