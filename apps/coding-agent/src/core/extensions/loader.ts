import { Effect, Function as Fn } from "effect";

import pathsModule from "../../utils/paths.ts";
import eventBusModule from "../event-bus.ts";
import type eventBusTypes from "../event-bus.types.ts";
import loaderCache from "./loader-cache.ts";
import loaderDiscovery from "./loader-discovery.ts";
import loaderExtension from "./loader-extension.ts";
import loaderFactory from "./loader-factory.ts";
import loaderRuntime from "./loader-runtime.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { useExtensionCacheCwd } = loaderCache;
const { createAgentDirExtensionRuntime } = loaderRuntime;
const { createEventBus } = eventBusModule;
const { loadExtension } = loaderExtension;
const { resolvePath } = pathsModule;
const { discoverExtensionPaths } = loaderDiscovery;

const loadAll = Effect.fn("loadExtensions")(function* (input: {
  paths: string[];
  cwd: string;
  agentDir: string | undefined;
  eventBus: eventBusTypes.EventBus | undefined;
  runtime: extensionsTypesTypes.ExtensionRuntime | undefined;
  useCache: boolean;
}) {
  const extensions: extensionsTypesTypes.Extension[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const cacheToken = input.useCache ? useExtensionCacheCwd(input.cwd) : undefined;
  const cwd = cacheToken?.cwd ?? resolvePath(input.cwd);
  const eventBus = input.eventBus ?? createEventBus();
  const runtime =
    input.runtime ??
    (yield* Effect.promise(() => createAgentDirExtensionRuntime(cwd, input.agentDir)));
  for (const extensionPath of input.paths) {
    const { extension, error } = yield* loadExtension({
      cacheToken,
      cwd,
      eventBus,
      extensionPath,
      runtime,
    });
    if (error !== null && error !== "") errors.push({ error, path: extensionPath });
    else if (extension !== null) extensions.push(extension);
  }
  const result: extensionsTypesTypes.LoadExtensionsResult = {
    errors,
    extensions,
    runtime,
    warnings: [],
  };
  return result;
});

type LoadRest = [
  cwd: string,
  eventBus?: eventBusTypes.EventBus,
  runtime?: extensionsTypesTypes.ExtensionRuntime,
];

const loadExtensionsWith =
  (useCache: boolean) =>
  (
    paths: string[],
    ...[cwd, eventBus, runtime]: LoadRest
  ): Promise<extensionsTypesTypes.LoadExtensionsResult> =>
    Effect.runPromise(loadAll({ agentDir: undefined, cwd, eventBus, paths, runtime, useCache }));

const loadExtensions: {
  (...rest: LoadRest): (paths: string[]) => Promise<extensionsTypesTypes.LoadExtensionsResult>;
  (paths: string[], ...rest: LoadRest): Promise<extensionsTypesTypes.LoadExtensionsResult>;
} = Fn.dual((args) => Array.isArray(args[0]), loadExtensionsWith(false));

const loadExtensionsCached: {
  (...rest: LoadRest): (paths: string[]) => Promise<extensionsTypesTypes.LoadExtensionsResult>;
  (paths: string[], ...rest: LoadRest): Promise<extensionsTypesTypes.LoadExtensionsResult>;
} = Fn.dual((args) => Array.isArray(args[0]), loadExtensionsWith(true));

type DiscoverRest = [cwd: string, agentDir?: string, eventBus?: eventBusTypes.EventBus];

const discoverAndLoadImpl = (
  configuredPaths: string[],
  ...[cwd, agentDir, eventBus]: DiscoverRest
): Promise<extensionsTypesTypes.LoadExtensionsResult> =>
  discoverExtensionPaths({
    configuredPaths,
    cwd,
    ...(agentDir === undefined ? {} : { agentDir }),
  }).then(({ resolvedCwd, allPaths }) =>
    Effect.runPromise(
      loadAll({
        agentDir,
        cwd: resolvedCwd,
        eventBus,
        paths: allPaths,
        runtime: undefined,
        useCache: false,
      }),
    ),
  );

const discoverAndLoadExtensions: {
  (
    ...rest: DiscoverRest
  ): (configuredPaths: string[]) => Promise<extensionsTypesTypes.LoadExtensionsResult>;
  (
    configuredPaths: string[],
    ...rest: DiscoverRest
  ): Promise<extensionsTypesTypes.LoadExtensionsResult>;
} = Fn.dual((args) => Array.isArray(args[0]), discoverAndLoadImpl);

const loader = {
  clearExtensionCache: loaderCache.clearExtensionCache,
  createExtensionRuntime: loaderRuntime.createExtensionRuntime,
  discoverAndLoadExtensions,
  loadExtensionFromFactory: loaderFactory.loadExtensionFromFactory,
  loadExtensions,
  loadExtensionsCached,
};

export default loader;
