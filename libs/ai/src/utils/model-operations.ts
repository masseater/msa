import { Clock, Effect, Function } from "effect";

import type typesModule from "../types.types.ts";
import modelsError from "./models-error.ts";

const { ModelsError } = modelsError;

const getModelType = (model: typesModule.AnyModel): typesModule.ModelType => model.type ?? "chat";

const isModelType: {
  <TType extends typesModule.ModelType>(
    type: TType,
  ): (model: typesModule.AnyModel) => model is typesModule.ModelTypeMap[TType];
  <TType extends typesModule.ModelType>(
    model: typesModule.AnyModel,
    type: TType,
  ): model is typesModule.ModelTypeMap[TType];
} = Function.dual(
  2,
  <TType extends typesModule.ModelType>(
    model: typesModule.AnyModel,
    type: TType,
  ): model is typesModule.ModelTypeMap[TType] => getModelType(model) === type,
);

function assertChatModel(
  model: typesModule.AnyModel,
): asserts model is typesModule.Model<typesModule.Api> {
  if (!isModelType(model, "chat")) {
    throw ModelsError.create("provider", `Model ${model.provider}/${model.id} is not a chat model`);
  }
}

function assertImageModel(
  model: typesModule.AnyModel,
): asserts model is typesModule.ImageModel<typesModule.ImageApi> {
  if (!isModelType(model, "image")) {
    throw ModelsError.create(
      "provider",
      `Model ${model.provider}/${model.id} is not an image model`,
    );
  }
}

function assertClassifierModel(
  model: typesModule.AnyModel,
): asserts model is typesModule.ClassifierModel<typesModule.ClassifierApi> {
  if (!isModelType(model, "classifier")) {
    throw ModelsError.create(
      "provider",
      `Model ${model.provider}/${model.id} is not a classifier model`,
    );
  }
}

const assertClassifierInputSupported: {
  (
    context: typesModule.ClassifierContext,
  ): (model: typesModule.ClassifierModel<typesModule.ClassifierApi>) => void;
  (
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
    context: typesModule.ClassifierContext,
  ): void;
} = Function.dual(
  2,
  (
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
    context: typesModule.ClassifierContext,
  ): void => {
    if (
      context.images?.length !== undefined &&
      context.images?.length > 0 &&
      !model.input.includes("image")
    ) {
      throw ModelsError.create(
        "provider",
        `Model ${model.provider}/${model.id} does not accept image input`,
      );
    }
  },
);

const errorFields = (error: unknown, aborted: boolean) => ({
  errorMessage: error instanceof Error ? error.message : String(error),
  stopReason: aborted ? ("aborted" as const) : ("error" as const),
  timestamp: Effect.runSync(Clock.currentTimeMillis),
});

const isImageModel = (value: unknown): value is typesModule.ImageModel<typesModule.ImageApi> =>
  typeof value === "object" && value !== null && "api" in value && "provider" in value;

const imageErrorResult: {
  (
    error: unknown,
    aborted?: boolean,
  ): (model: typesModule.ImageModel<typesModule.ImageApi>) => typesModule.AssistantImages;
  (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    error: unknown,
    aborted?: boolean,
  ): typesModule.AssistantImages;
} = Function.dual(
  (args) => args.length >= 3 || (args.length === 2 && isImageModel(args[0])),
  (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    error: unknown,
    aborted = false,
  ): typesModule.AssistantImages => ({
    api: model.api,
    model: model.id,
    output: [],
    provider: model.provider,
    ...errorFields(error, aborted),
  }),
);

const classifierErrorResult: {
  (
    error: unknown,
    aborted?: boolean,
  ): (
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  ) => typesModule.ClassifierResult;
  (
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
    error: unknown,
    aborted?: boolean,
  ): typesModule.ClassifierResult;
} = Function.dual(
  (args) => args.length >= 3 || (args.length === 2 && isImageModel(args[0])),
  (
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
    error: unknown,
    aborted = false,
  ): typesModule.ClassifierResult => ({
    answers: {},
    api: model.api,
    model: model.id,
    provider: model.provider,
    ...errorFields(error, aborted),
  }),
);

const modelOperations = {
  assertChatModel,
  assertClassifierInputSupported,
  assertClassifierModel,
  assertImageModel,
  classifierErrorResult,
  getModelType,
  imageErrorResult,
  isModelType,
};

export default modelOperations;
