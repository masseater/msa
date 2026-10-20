import type typesModule from "./types.types.ts";

declare namespace modelCatalogTypes {
  type ModelGroups = Record<string, Record<string, object>>;

  type ModelKey<TGroups extends ModelGroups> = {
    [TApi in keyof TGroups]: keyof TGroups[TApi];
  }[keyof TGroups] &
    string;

  type KeyForType<TGroups extends ModelGroups, TType extends typesModule.ModelType> = Extract<
    ModelKey<TGroups>,
    `${TType}:${string}`
  >;

  type ModelId<TKey extends string> = TKey extends `${typesModule.ModelType}:${infer TModelId}`
    ? TModelId
    : never;

  type ApiForKey<TGroups extends ModelGroups, TKey extends ModelKey<TGroups>> = {
    [TApi in keyof TGroups]: TKey extends keyof TGroups[TApi] ? TApi : never;
  }[keyof TGroups];

  type ChatModelCatalog<TGroups extends ModelGroups, TProvider extends typesModule.ProviderId> = {
    [TKey in KeyForType<TGroups, "chat"> as ModelId<TKey>]: typesModule.Model<
      ApiForKey<TGroups, TKey> & typesModule.Api
    > & {
      id: ModelId<TKey>;
      provider: TProvider;
    };
  };

  type ImageModelCatalog<TGroups extends ModelGroups, TProvider extends typesModule.ProviderId> = {
    [TKey in KeyForType<TGroups, "image"> as ModelId<TKey>]: typesModule.ImageModel<
      ApiForKey<TGroups, TKey> & typesModule.ImageApi
    > & {
      id: ModelId<TKey>;
      provider: TProvider;
    };
  };

  type ClassifierModelCatalog<
    TGroups extends ModelGroups,
    TProvider extends typesModule.ProviderId,
  > = {
    [TKey in KeyForType<TGroups, "classifier"> as ModelId<TKey>]: typesModule.ClassifierModel<
      ApiForKey<TGroups, TKey> & typesModule.ClassifierApi
    > & {
      id: ModelId<TKey>;
      provider: TProvider;
    };
  };
}

export type { modelCatalogTypes as default };
