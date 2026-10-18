import { DateTime, Effect } from "effect";

import { encodeJson, encodeJsonPretty } from "../../src/utils/json-codec.ts";
import type { BuiltCatalog } from "./catalog-build.ts";
import { groupCatalogData } from "./catalog-data.ts";
import { writeJsonCatalog } from "./catalog-json-output.ts";
import { writeGeneratedCatalog } from "./catalog-write.ts";
import type { GeneratorOptions } from "./options.ts";

export interface CatalogPublication {
  readonly packageRoot: string;
  readonly catalog: BuiltCatalog;
  readonly options: GeneratorOptions;
}

export const publishCatalog = Effect.fn("publishCatalog")(function* ({
  packageRoot,
  catalog,
  options,
}: CatalogPublication) {
  const encode = options.pretty ? encodeJsonPretty : encodeJson;
  const serialize = (value: unknown) => Effect.map(encode(value), (json) => `${json}\n`);
  const grouped = yield* groupCatalogData({ packageRoot, catalog, dataOnly: options.dataOnly });
  const generatedAt = DateTime.formatIso(yield* DateTime.now);
  if (!options.jsonOnly) {
    yield* writeGeneratedCatalog({
      packageRoot,
      providerIds: catalog.providerIds,
      grouped,
      generatedAt,
      dataOnly: options.dataOnly,
      serialize,
    });
  }
  if (options.jsonOutputDir !== undefined && options.jsonOutputDir !== "")
    yield* writeJsonCatalog({ outputDir: options.jsonOutputDir, catalog, serialize });
});
