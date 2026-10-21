import { Cause, Console, Effect, ManagedRuntime } from "effect";

import type typesModule from "../src/types.types.ts";
import assembleChatModels from "./catalog/catalog-assembly.ts";
import buildCatalog from "./catalog/catalog-build.ts";
import type catalogBuildTypes from "./catalog/catalog-build.types.ts";
import optionsModule from "./catalog/options.ts";
import publishCatalog from "./catalog/publish.ts";
import loadUpstreamModels from "./catalog/upstream-models.ts";
import scriptFiles from "./script-files.ts";

const { readGeneratorOptions } = optionsModule;
const { ScriptFiles, scriptFilesLayer } = scriptFiles;

const logStatistics = Effect.fn("logStatistics")(function* (
  chat: readonly typesModule.Model<any>[],
  catalog: catalogBuildTypes.BuiltCatalog,
) {
  yield* Console.log(`\nModel Statistics:`);
  yield* Console.log(`  Total tool-capable models: ${chat.length}`);
  yield* Console.log(
    `  Reasoning-capable models: ${chat.filter((model) => model.reasoning).length}`,
  );
  for (const { provider, chat: chatCount, image, classifier } of catalog.counts) {
    yield* Console.log(
      `  ${provider}: ${chatCount} chat models, ${image} image models, ${classifier} classifier models`,
    );
  }
});

const generateModels = Effect.gen(function* () {
  const files = yield* ScriptFiles;
  const options = yield* readGeneratorOptions(process.argv.slice(2));
  const upstream = yield* loadUpstreamModels(options.strict);
  const chat = assembleChatModels({ reasoning: upstream.reasoning, upstream: upstream.chat });
  const catalog = buildCatalog({ ...upstream, chat });
  yield* publishCatalog({ catalog, options, packageRoot: files.join(import.meta.dirname, "..") });
  yield* logStatistics(chat, catalog);
});

ManagedRuntime.make(scriptFilesLayer).runFork(
  generateModels.pipe(
    Effect.catchCause((cause) =>
      Effect.andThen(
        Console.error(Cause.pretty(cause)),
        Effect.sync(() => {
          process.exitCode = 1;
        }),
      ),
    ),
  ),
);
