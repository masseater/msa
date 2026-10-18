import { Effect } from "effect";

import {
  groupProviderModelData,
  ModelDataError,
  type ModelDataStructure,
  readModelDataProviderIds,
} from "../model-data.ts";
import type { BuiltCatalog, CatalogEntry } from "./catalog-build.ts";

export interface GroupedCatalog {
  readonly providerIds: readonly string[];
  readonly groups: Readonly<Record<string, Record<string, Record<string, CatalogEntry>>>>;
  readonly structure: ModelDataStructure;
}

export interface CatalogGrouping {
  readonly packageRoot: string;
  readonly catalog: BuiltCatalog;
  readonly dataOnly: boolean;
}

const missingProviders = (providerIds: readonly string[]) =>
  Effect.fail(
    new ModelDataError({
      message: `Cannot hydrate missing providers: ${providerIds.join(", ")}`,
    }),
  );

export const groupCatalogData = Effect.fn("groupCatalogData")(function* ({
  packageRoot,
  catalog,
  dataOnly,
}: CatalogGrouping) {
  const providerIds = dataOnly ? yield* readModelDataProviderIds(packageRoot) : catalog.providerIds;
  const missing = providerIds.filter(
    (providerId) => catalog.allProviders[providerId] === undefined,
  );
  if (missing.length > 0) return yield* missingProviders(missing);
  const groups: Record<string, Record<string, Record<string, CatalogEntry>>> = {};
  const structure: ModelDataStructure = {};
  for (const providerId of providerIds) {
    const grouped = yield* groupProviderModelData(
      providerId,
      catalog.allProviders[providerId] ?? [],
    );
    groups[providerId] = grouped.groups;
    structure[providerId] = grouped.structure;
  }
  return { providerIds, groups, structure } satisfies GroupedCatalog;
});
