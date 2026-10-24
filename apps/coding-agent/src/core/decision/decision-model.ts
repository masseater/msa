import type aiTypes from "@msa/ai/index.types";
import localModule from "@msa/ai/providers/local";
import { Effect } from "effect";

import type modelRuntimeTypes from "../model-runtime.types.ts";
import type ModelSettings from "../settings/model-settings.ts";
import type decideTypes from "./decide.types.ts";

const { LIQUID_D1 } = localModule;

type Runtime = Pick<modelRuntimeTypes.ModelRuntime, "getModelOfType" | "getProvider">;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function decisionModelReference(settings: ModelSettings): string {
  return settings.getDecisionModel() ?? `${LIQUID_D1.provider}/${LIQUID_D1.id}`;
}

function resolveDecisionModel(
  settings: ModelSettings,
  runtime: Runtime,
): ReturnType<decideTypes.DecisionHost["model"]> {
  const reference = decisionModelReference(settings);
  const slash = reference.indexOf("/");
  const model: aiTypes.ClassifierModel<aiTypes.ClassifierApi> | undefined =
    slash > 0
      ? runtime.getModelOfType("classifier", reference.slice(0, slash), reference.slice(slash + 1))
      : undefined;
  return model === undefined
    ? { unavailable: `decision.model "${reference}" is not an available classifier` }
    : { model };
}

function prepareDecisionModel(
  settings: ModelSettings,
  runtime: Runtime,
): Promise<decideTypes.DecisionModelPreparation> {
  const reference = decisionModelReference(settings);
  const resolved = resolveDecisionModel(settings, runtime);
  if ("unavailable" in resolved)
    return Promise.resolve({ model: reference, reason: resolved.unavailable, status: "failed" });
  const { model } = resolved;
  return Effect.runPromise(
    Effect.tryPromise(
      () =>
        runtime.getProvider(model.provider)?.prepareClassifier?.(model) ??
        Promise.resolve({ fetched: false }),
    ).pipe(
      Effect.match({
        onFailure: ({ cause }): decideTypes.DecisionModelPreparation => ({
          model: reference,
          reason: errorText(cause),
          status: "failed",
        }),
        onSuccess: ({ fetched }): decideTypes.DecisionModelPreparation => ({
          fetched,
          model: reference,
          status: "ready",
        }),
      }),
    ),
  );
}

const decisionModel = { prepareDecisionModel, resolveDecisionModel };

export default decisionModel;
