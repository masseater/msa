import { Function } from "effect";

import type modelCatalogTypes from "./model-catalog.types.ts";
import type typesModule from "./types.types.ts";

function flattenModelCatalog(
  groups: modelCatalogTypes.ModelGroups,
  type: typesModule.ModelType,
): Record<string, object> {
  return Object.fromEntries(
    Object.values(groups)
      .flatMap((models) => Object.values(models))
      .filter((model) => (model as { type?: unknown }).type === type)
      .map((model) => [(model as { id: string }).id, model]),
  );
}

const flattenChatModelCatalog: {
  <
    const TProvider extends typesModule.ProviderId,
    const TGroups extends modelCatalogTypes.ModelGroups,
  >(
    groups: TGroups,
  ): (_provider: TProvider) => modelCatalogTypes.ChatModelCatalog<TGroups, TProvider>;
  <
    const TProvider extends typesModule.ProviderId,
    const TGroups extends modelCatalogTypes.ModelGroups,
  >(
    _provider: TProvider,
    groups: TGroups,
  ): modelCatalogTypes.ChatModelCatalog<TGroups, TProvider>;
} = Function.dual(2, function <
  const TProvider extends typesModule.ProviderId,
  const TGroups extends modelCatalogTypes.ModelGroups,
>(_provider: TProvider, groups: TGroups): modelCatalogTypes.ChatModelCatalog<TGroups, TProvider> {
  return flattenModelCatalog(groups, "chat") as modelCatalogTypes.ChatModelCatalog<
    TGroups,
    TProvider
  >;
});

const flattenImageModelCatalog: {
  <
    const TProvider extends typesModule.ProviderId,
    const TGroups extends modelCatalogTypes.ModelGroups,
  >(
    groups: TGroups,
  ): (_provider: TProvider) => modelCatalogTypes.ImageModelCatalog<TGroups, TProvider>;
  <
    const TProvider extends typesModule.ProviderId,
    const TGroups extends modelCatalogTypes.ModelGroups,
  >(
    _provider: TProvider,
    groups: TGroups,
  ): modelCatalogTypes.ImageModelCatalog<TGroups, TProvider>;
} = Function.dual(2, function <
  const TProvider extends typesModule.ProviderId,
  const TGroups extends modelCatalogTypes.ModelGroups,
>(_provider: TProvider, groups: TGroups): modelCatalogTypes.ImageModelCatalog<TGroups, TProvider> {
  return flattenModelCatalog(groups, "image") as modelCatalogTypes.ImageModelCatalog<
    TGroups,
    TProvider
  >;
});

const flattenClassifierModelCatalog: {
  <
    const TProvider extends typesModule.ProviderId,
    const TGroups extends modelCatalogTypes.ModelGroups,
  >(
    groups: TGroups,
  ): (_provider: TProvider) => modelCatalogTypes.ClassifierModelCatalog<TGroups, TProvider>;
  <
    const TProvider extends typesModule.ProviderId,
    const TGroups extends modelCatalogTypes.ModelGroups,
  >(
    _provider: TProvider,
    groups: TGroups,
  ): modelCatalogTypes.ClassifierModelCatalog<TGroups, TProvider>;
} = Function.dual(2, function <
  const TProvider extends typesModule.ProviderId,
  const TGroups extends modelCatalogTypes.ModelGroups,
>(_provider: TProvider, groups: TGroups): modelCatalogTypes.ClassifierModelCatalog<
  TGroups,
  TProvider
> {
  return flattenModelCatalog(groups, "classifier") as modelCatalogTypes.ClassifierModelCatalog<
    TGroups,
    TProvider
  >;
});

const modelCatalog = {
  flattenChatModelCatalog,
  flattenClassifierModelCatalog,
  flattenImageModelCatalog,
};

export default modelCatalog;
