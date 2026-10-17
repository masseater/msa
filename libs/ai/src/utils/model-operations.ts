import { Clock, Effect, Function } from "effect";

import type {
  AnyModel,
  Api,
  AssistantImages,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  ImageApi,
  ImageModel,
  Model,
  ModelType,
  ModelTypeMap,
} from "../types.ts";
import { ModelsError } from "./models-error.ts";

export const getModelType = (model: AnyModel): ModelType => model.type ?? "chat";

export const isModelType: {
  <TType extends ModelType>(type: TType): (model: AnyModel) => model is ModelTypeMap[TType];
  <TType extends ModelType>(model: AnyModel, type: TType): model is ModelTypeMap[TType];
} = Function.dual(
  2,
  <TType extends ModelType>(model: AnyModel, type: TType): model is ModelTypeMap[TType] =>
    getModelType(model) === type,
);

export function assertChatModel(model: AnyModel): asserts model is Model<Api> {
  if (!isModelType(model, "chat")) {
    throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not a chat model`);
  }
}

export function assertImageModel(model: AnyModel): asserts model is ImageModel<ImageApi> {
  if (!isModelType(model, "image")) {
    throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not an image model`);
  }
}

export function assertClassifierModel(
  model: AnyModel,
): asserts model is ClassifierModel<ClassifierApi> {
  if (!isModelType(model, "classifier")) {
    throw new ModelsError(
      "provider",
      `Model ${model.provider}/${model.id} is not a classifier model`,
    );
  }
}

export const assertClassifierInputSupported: {
  (context: ClassifierContext): (model: ClassifierModel<ClassifierApi>) => void;
  (model: ClassifierModel<ClassifierApi>, context: ClassifierContext): void;
} = Function.dual(2, (model: ClassifierModel<ClassifierApi>, context: ClassifierContext): void => {
  if (
    context.images?.length !== undefined &&
    context.images?.length > 0 &&
    !model.input.includes("image")
  ) {
    throw new ModelsError(
      "provider",
      `Model ${model.provider}/${model.id} does not accept image input`,
    );
  }
});

const errorFields = (error: unknown, aborted: boolean) => ({
  stopReason: aborted ? ("aborted" as const) : ("error" as const),
  errorMessage: error instanceof Error ? error.message : String(error),
  timestamp: Effect.runSync(Clock.currentTimeMillis),
});

const isImageModel = (value: unknown): value is ImageModel<ImageApi> =>
  typeof value === "object" && value !== null && "api" in value && "provider" in value;

export const imageErrorResult: {
  (error: unknown, aborted?: boolean): (model: ImageModel<ImageApi>) => AssistantImages;
  (model: ImageModel<ImageApi>, error: unknown, aborted?: boolean): AssistantImages;
} = Function.dual(
  (args) => args.length >= 3 || (args.length === 2 && isImageModel(args[0])),
  (model: ImageModel<ImageApi>, error: unknown, aborted = false): AssistantImages => ({
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [],
    ...errorFields(error, aborted),
  }),
);

export const classifierErrorResult: {
  (error: unknown, aborted?: boolean): (model: ClassifierModel<ClassifierApi>) => ClassifierResult;
  (model: ClassifierModel<ClassifierApi>, error: unknown, aborted?: boolean): ClassifierResult;
} = Function.dual(
  (args) => args.length >= 3 || (args.length === 2 && isImageModel(args[0])),
  (model: ClassifierModel<ClassifierApi>, error: unknown, aborted = false): ClassifierResult => ({
    api: model.api,
    provider: model.provider,
    model: model.id,
    answers: {},
    ...errorFields(error, aborted),
  }),
);
