import type { Api, ClassifierApi, ImageApi, ProviderClassifier, ProviderImages } from "../types.ts";
import { classifierErrorResult, imageErrorResult } from "../utils/model-operations.ts";
import { ModelsError } from "../utils/models-error.ts";
import type { Provider } from "./provider-types.ts";

const presentCount = (record: Partial<Record<string, unknown>>): number =>
  Object.values(record).filter((entry) => entry !== undefined).length;

export interface ImageCapabilities<TApi extends Api> {
  readonly provider: Provider<TApi>;
  readonly input: Partial<Record<ImageApi, ProviderImages>> | undefined;
}

export const attachImages = <TApi extends Api>({
  provider,
  input,
}: ImageCapabilities<TApi>): void => {
  const images = input as Partial<Record<string, ProviderImages>> | undefined;
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

export interface ClassifierCapabilities<TApi extends Api> {
  readonly provider: Provider<TApi>;
  readonly input: Partial<Record<ClassifierApi, ProviderClassifier>> | undefined;
}

export const attachClassifiers = <TApi extends Api>({
  provider,
  input,
}: ClassifierCapabilities<TApi>): void => {
  const classifiers = input as Partial<Record<string, ProviderClassifier>> | undefined;
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
