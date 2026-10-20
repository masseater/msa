import { Function } from "effect";

import modelsKit from "./models-kit.ts";
import type modelsStateTypes from "./models-state.types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesModuleModule2 from "./types.types.ts";

const { modelOperations, modelsError } = modelsKit;
const { classifierErrorResult, imageErrorResult, isModelType } = modelOperations;
const { ModelsError } = modelsError;

const modelsOrEmpty = <A>(read: () => readonly A[]): readonly A[] => {
  try {
    return read();
  } catch {
    return [];
  }
};

interface CatalogQuery {
  readonly state: modelsStateTypes.ModelsState;
  readonly provider: string | undefined;
}

const collect = <A>(
  { state, provider }: CatalogQuery,
  read: (entry: providerTypesModule.Provider) => readonly A[],
): readonly A[] => {
  if (provider !== undefined) {
    const entry = state.providers.get(provider);
    return entry === undefined ? [] : modelsOrEmpty(() => read(entry));
  }
  return [...state.providers.values()].flatMap((entry) => modelsOrEmpty(() => read(entry)));
};

const listModels = (
  query: CatalogQuery,
): readonly typesModuleModule2.Model<typesModuleModule2.Api>[] =>
  collect(query, (entry) => entry.getModels());

const listAllModels = (query: CatalogQuery): readonly typesModuleModule2.AnyModel[] =>
  collect<typesModuleModule2.AnyModel>(
    query,
    (entry) => entry.getAllModels?.() ?? entry.getModels(),
  );

const ofType: {
  <TType extends typesModuleModule2.ModelType>(
    type: TType,
  ): (
    models: readonly typesModuleModule2.AnyModel[],
  ) => readonly typesModuleModule2.ModelTypeMap[TType][];
  <TType extends typesModuleModule2.ModelType>(
    models: readonly typesModuleModule2.AnyModel[],
    type: TType,
  ): readonly typesModuleModule2.ModelTypeMap[TType][];
} = Function.dual(
  2,
  <TType extends typesModuleModule2.ModelType>(
    models: readonly typesModuleModule2.AnyModel[],
    type: TType,
  ): readonly typesModuleModule2.ModelTypeMap[TType][] =>
    models.filter((model): model is typesModuleModule2.ModelTypeMap[TType] =>
      isModelType(model, type),
    ),
);

const presentCount = (record: Partial<Record<string, unknown>>): number =>
  Object.values(record).filter((entry) => entry !== undefined).length;

interface ImageCapabilities<TApi extends typesModuleModule2.Api> {
  readonly provider: providerTypesModule.Provider<TApi>;
  readonly input:
    | Partial<Record<typesModuleModule2.ImageApi, typesModuleModule2.ProviderImages>>
    | undefined;
}

const attachImages = <TApi extends typesModuleModule2.Api>({
  provider,
  input,
}: ImageCapabilities<TApi>): void => {
  const images = input as Partial<Record<string, typesModuleModule2.ProviderImages>> | undefined;
  if (images === undefined || presentCount(images) === 0) return;
  provider.generateImages = (model, context, options) => {
    const implementation = images[model.api];
    if (implementation === undefined) {
      return Promise.resolve(
        imageErrorResult(
          model,
          new ModelsError(
            "provider",
            `Provider ${provider.id} has no image generation implementation for "${model.api}"`,
          ),
        ),
      );
    }
    try {
      return implementation.generateImages(model, context, options);
    } catch (error) {
      return Promise.reject(error);
    }
  };
};

interface ClassifierCapabilities<TApi extends typesModuleModule2.Api> {
  readonly provider: providerTypesModule.Provider<TApi>;
  readonly input:
    | Partial<Record<typesModuleModule2.ClassifierApi, typesModuleModule2.ProviderClassifier>>
    | undefined;
}

const attachClassifiers = <TApi extends typesModuleModule2.Api>({
  provider,
  input,
}: ClassifierCapabilities<TApi>): void => {
  const classifiers = input as
    | Partial<Record<string, typesModuleModule2.ProviderClassifier>>
    | undefined;
  if (classifiers === undefined || presentCount(classifiers) === 0) return;
  provider.classify = (model, context, options) => {
    const implementation = classifiers[model.api];
    if (implementation === undefined) {
      return Promise.resolve(
        classifierErrorResult(
          model,
          new ModelsError(
            "provider",
            `Provider ${provider.id} has no classifier implementation for "${model.api}"`,
          ),
        ),
      );
    }
    try {
      return implementation.classify(model, context, options);
    } catch (error) {
      return Promise.reject(error);
    }
  };
};

const modelsCatalogQuery = {
  attachClassifiers,
  attachImages,
  collect,
  listAllModels,
  listModels,
  modelsOrEmpty,
  ofType,
  presentCount,
};

export default modelsCatalogQuery;
