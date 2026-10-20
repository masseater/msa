import { Effect } from "effect";

import ModelDataError from "../model-data-error.ts";
import modelData from "../model-data.ts";
import type modelDataTypes from "../model-data.types.ts";
import type catalogBuildTypes from "./catalog-build.types.ts";
import type catalogDataTypes from "./catalog-data.types.ts";

const { groupProviderModelData, readModelDataProviderIds } = modelData;

const missingProviders = (providerIds: readonly string[]) =>
  Effect.fail(
    new ModelDataError({
      message: `Cannot hydrate missing providers: ${providerIds.join(", ")}`,
    }),
  );

const groupCatalogData = Effect.fn("groupCatalogData")(function* ({
  packageRoot,
  catalog,
  dataOnly,
}: catalogDataTypes.CatalogGrouping) {
  const providerIds = dataOnly ? yield* readModelDataProviderIds(packageRoot) : catalog.providerIds;
  const missing = providerIds.filter(
    (providerId) => catalog.allProviders[providerId] === undefined,
  );
  if (missing.length > 0) return yield* missingProviders(missing);
  const groups: Record<string, Record<string, Record<string, catalogBuildTypes.CatalogEntry>>> = {};
  const structure: modelDataTypes.ModelDataStructure = {};
  for (const providerId of providerIds) {
    const grouped = yield* groupProviderModelData(
      providerId,
      catalog.allProviders[providerId] ?? [],
    );
    groups[providerId] = grouped.groups;
    structure[providerId] = grouped.structure;
  }
  return { groups, providerIds, structure } satisfies catalogDataTypes.GroupedCatalog;
});

export default groupCatalogData;
