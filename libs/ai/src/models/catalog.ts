import { Function } from "effect";

import type { AnyModel, Api, Model, ModelType, ModelTypeMap } from "../types.ts";
import { isModelType } from "../utils/model-operations.ts";
import type { Provider } from "./provider-types.ts";
import type { ModelsState } from "./state.ts";

const modelsOrEmpty = <A>(read: () => readonly A[]): readonly A[] => {
  try {
    return read();
  } catch {
    return [];
  }
};

export interface CatalogQuery {
  readonly state: ModelsState;
  readonly provider: string | undefined;
}

const collect = <A>(
  { state, provider }: CatalogQuery,
  read: (entry: Provider) => readonly A[],
): readonly A[] => {
  if (provider !== undefined) {
    const entry = state.providers.get(provider);
    return entry === undefined ? [] : modelsOrEmpty(() => read(entry));
  }
  return [...state.providers.values()].flatMap((entry) => modelsOrEmpty(() => read(entry)));
};

export const listModels = (query: CatalogQuery): readonly Model<Api>[] =>
  collect(query, (entry) => entry.getModels());

export const listAllModels = (query: CatalogQuery): readonly AnyModel[] =>
  collect<AnyModel>(query, (entry) => entry.getAllModels?.() ?? entry.getModels());

export const ofType: {
  <TType extends ModelType>(
    type: TType,
  ): (models: readonly AnyModel[]) => readonly ModelTypeMap[TType][];
  <TType extends ModelType>(
    models: readonly AnyModel[],
    type: TType,
  ): readonly ModelTypeMap[TType][];
} = Function.dual(
  2,
  <TType extends ModelType>(
    models: readonly AnyModel[],
    type: TType,
  ): readonly ModelTypeMap[TType][] =>
    models.filter((model): model is ModelTypeMap[TType] => isModelType(model, type)),
);
