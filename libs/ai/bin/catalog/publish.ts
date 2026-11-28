import { DateTime, Effect } from "effect";

import jsonCodec from "../../src/utils/json-codec.ts";
import groupCatalogData from "./catalog-data.ts";
import writeJsonCatalog from "./catalog-json-output.ts";
import writeGeneratedCatalog from "./catalog-write.ts";
import type publishTypes from "./publish.types.ts";

const { encodeJson, encodeJsonPretty } = jsonCodec;

const publishCatalog = Effect.fn("publishCatalog")(function* ({
  packageRoot,
  catalog,
  options,
}: publishTypes.CatalogPublication) {
  const encode = options.pretty ? encodeJsonPretty : encodeJson;
  const serialize = (value: unknown) => Effect.map(encode(value), (json) => `${json}\n`);
  const grouped = yield* groupCatalogData({ catalog, dataOnly: options.dataOnly, packageRoot });
  const generatedAt = DateTime.formatIso(yield* DateTime.now);
  if (!options.jsonOnly) {
    yield* writeGeneratedCatalog({
      dataOnly: options.dataOnly,
      generatedAt,
      grouped,
      packageRoot,
      providerIds: catalog.providerIds,
      serialize,
    });
  }
  if (options.jsonOutputDir !== undefined && options.jsonOutputDir !== "")
    yield* writeJsonCatalog({ catalog, outputDir: options.jsonOutputDir, serialize });
});

export default publishCatalog;
