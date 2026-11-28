import { Effect } from "effect";

import scriptOutput from "../../src/utils/script-output.ts";
import scriptFiles from "../script-files.ts";
import type catalogJsonOutputTypes from "./catalog-json-output.types.ts";

const { ScriptFiles } = scriptFiles;

const writeJsonCatalog = Effect.fn("writeJsonCatalog")(function* ({
  outputDir,
  catalog,
  serialize,
}: catalogJsonOutputTypes.JsonCatalogOutput) {
  const files = yield* ScriptFiles;
  const writeJson = (path: string, value: unknown) =>
    Effect.flatMap(serialize(value), (content) => files.writeTextFile({ content, path }));
  const providerOutputDir = files.join(outputDir, "providers");
  yield* files.remove(outputDir);
  yield* files.makeDirectory(providerOutputDir);
  yield* writeJson(files.join(outputDir, "models.json"), catalog.chatProviders);
  yield* writeJson(files.join(outputDir, "models.all.json"), catalog.allProviders);
  yield* writeJson(files.join(outputDir, "providers.json"), catalog.providerIds);
  for (const providerId of catalog.providerIds) {
    yield* writeJson(
      files.join(providerOutputDir, `${providerId}.json`),
      catalog.chatProviders[providerId],
    );
    yield* writeJson(
      files.join(providerOutputDir, `${providerId}.all.json`),
      catalog.allProviders[providerId],
    );
  }
  yield* scriptOutput.print(`Generated JSON model catalog under ${outputDir}`);
});

export default writeJsonCatalog;
