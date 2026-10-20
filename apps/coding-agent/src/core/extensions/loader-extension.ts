import { Effect } from "effect";

import paths from "../../utils/paths.ts";
import type eventBusTypes from "../event-bus.types.ts";
import platform from "../platform/index.ts";
import sourceInfoModule from "../source-info.ts";
import timings from "../timings.ts";
import loaderApi from "./loader-api.ts";
import type loaderCacheTypes from "./loader-cache.types.ts";
import type loaderExtensionTypes from "./loader-extension.types.ts";
import loaderModule from "./loader-module.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { createSyntheticSourceInfo, getSyntheticPathSource, isSyntheticPath } = sourceInfoModule;
const { causeMessage, fromPromise, pathOperations } = platform;
const { createExtensionAPI } = loaderApi;
const { time } = timings;
const { resolvePath } = paths;
const { loadExtensionModule } = loaderModule;

function createExtension(
  extensionPath: string,
  resolvedPath: string,
): extensionsTypesTypes.Extension {
  const source = getSyntheticPathSource(extensionPath) ?? "local";
  const baseDir = isSyntheticPath(extensionPath) ? undefined : pathOperations.dirname(resolvedPath);

  return {
    commands: new Map(),
    entryRenderers: new Map(),
    flags: new Map(),
    handlers: new Map(),
    messageRenderers: new Map(),
    path: extensionPath,
    resolvedPath,
    shortcuts: new Map(),
    sourceInfo: createSyntheticSourceInfo(extensionPath, { baseDir, source }),
    tools: new Map(),
  };
}

interface InitializeInput {
  factory: extensionsTypesTypes.ExtensionFactory;
  extensionPath: string;
  resolvedPath: string;
  cwd: string;
  eventBus: eventBusTypes.EventBus;
  runtime: extensionsTypesTypes.ExtensionRuntime;
}

const initializeExtension = Effect.fn("initializeExtension")(function* (input: InitializeInput) {
  const { factory, extensionPath, resolvedPath, cwd, eventBus, runtime } = input;
  const extension = createExtension(extensionPath, resolvedPath);
  const load = createExtensionAPI({ cwd, eventBus, extension, runtime });
  yield* fromPromise(() => factory(load.api)).pipe(
    Effect.andThen(Effect.sync(() => load.commit())),
    Effect.tapCause(() => Effect.sync(() => load.discard())),
  );
  time(`${extensionPath} factory`, "extensions");
  return extension;
});

interface LoadOneInput {
  extensionPath: string;
  cwd: string;
  eventBus: eventBusTypes.EventBus;
  runtime: extensionsTypesTypes.ExtensionRuntime;
  cacheToken?: loaderCacheTypes.ExtensionCacheToken | undefined;
}

const loadExtension = ({ extensionPath, cwd, eventBus, runtime, cacheToken }: LoadOneInput) =>
  Effect.gen(function* () {
    const resolvedPath = resolvePath(extensionPath, cwd, { normalizeUnicodeSpaces: true });
    const factory = yield* loadExtensionModule({ cacheToken, extensionPath: resolvedPath });
    time(`${extensionPath} module import`, "extensions");
    if (factory === undefined) {
      return {
        error: `Extension does not export a valid factory function: ${extensionPath}`,
        extension: null,
      } as loaderExtensionTypes.LoadOutcome;
    }
    const extension = yield* initializeExtension({
      cwd,
      eventBus,
      extensionPath,
      factory,
      resolvedPath,
      runtime,
    });
    return { error: null, extension } as loaderExtensionTypes.LoadOutcome;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed({
        error: `Failed to load extension: ${causeMessage(cause)}`,
        extension: null,
      } as loaderExtensionTypes.LoadOutcome),
    ),
  );

const loaderExtension = {
  initializeExtension,
  loadExtension,
};

export default loaderExtension;
