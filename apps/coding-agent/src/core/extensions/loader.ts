import { Effect, Function as Fn } from "effect";

import { resolvePath } from "../../utils/paths.ts";
import { createEventBus, type EventBus } from "../event-bus.ts";
import { fromPromise, platformRuntime, unwrapForeign } from "../platform/index.ts";
import { useExtensionCacheCwd } from "./loader-cache.ts";
import { discoverExtensionPaths } from "./loader-discovery.ts";
import { initializeExtension, loadExtension } from "./loader-extension.ts";
import { createExtensionRuntime } from "./loader-runtime.ts";
import type {
  Extension,
  ExtensionFactory,
  ExtensionRuntime,
  LoadExtensionsResult,
} from "./types.ts";

export { clearExtensionCache } from "./loader-cache.ts";
export { createExtensionRuntime } from "./loader-runtime.ts";

const loadExtensionFromFactoryImpl = (
  factory: ExtensionFactory,
  cwd: string,
  eventBus: EventBus,
  runtime: ExtensionRuntime,
  extensionPath = "<inline>",
): Promise<Extension> =>
  platformRuntime.runPromise(
    unwrapForeign(
      initializeExtension({
        factory,
        extensionPath,
        resolvedPath: extensionPath,
        cwd: resolvePath(cwd),
        eventBus,
        runtime,
      }),
    ),
  );

export const loadExtensionFromFactory: {
  (
    cwd: string,
    eventBus: EventBus,
    runtime: ExtensionRuntime,
    extensionPath?: string,
  ): (factory: ExtensionFactory) => Promise<Extension>;
  (
    factory: ExtensionFactory,
    cwd: string,
    eventBus: EventBus,
    runtime: ExtensionRuntime,
    extensionPath?: string,
  ): Promise<Extension>;
} = Fn.dual((args) => typeof args[0] === "function", loadExtensionFromFactoryImpl);

const loadAll = Effect.fn("loadExtensions")(function* (input: {
  paths: string[];
  cwd: string;
  eventBus: EventBus | undefined;
  runtime: ExtensionRuntime | undefined;
  useCache: boolean;
}) {
  const extensions: Extension[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const cacheToken = input.useCache ? useExtensionCacheCwd(input.cwd) : undefined;
  const cwd = cacheToken?.cwd ?? resolvePath(input.cwd);
  const eventBus = input.eventBus ?? createEventBus();
  const runtime = input.runtime ?? createExtensionRuntime();
  for (const extensionPath of input.paths) {
    const { extension, error } = yield* loadExtension({
      extensionPath,
      cwd,
      eventBus,
      runtime,
      cacheToken,
    });
    if (error !== null && error !== "") errors.push({ path: extensionPath, error });
    else if (extension !== null) extensions.push(extension);
  }
  const result: LoadExtensionsResult = { extensions, errors, warnings: [], runtime };
  return result;
});

type LoadRest = [cwd: string, eventBus?: EventBus, runtime?: ExtensionRuntime];

const loadExtensionsWith =
  (useCache: boolean) =>
  (paths: string[], ...[cwd, eventBus, runtime]: LoadRest): Promise<LoadExtensionsResult> =>
    platformRuntime.runPromise(loadAll({ paths, cwd, eventBus, runtime, useCache }));

export const loadExtensions: {
  (...rest: LoadRest): (paths: string[]) => Promise<LoadExtensionsResult>;
  (paths: string[], ...rest: LoadRest): Promise<LoadExtensionsResult>;
} = Fn.dual((args) => Array.isArray(args[0]), loadExtensionsWith(false));

export const loadExtensionsCached: {
  (...rest: LoadRest): (paths: string[]) => Promise<LoadExtensionsResult>;
  (paths: string[], ...rest: LoadRest): Promise<LoadExtensionsResult>;
} = Fn.dual((args) => Array.isArray(args[0]), loadExtensionsWith(true));

type DiscoverRest = [cwd: string, agentDir?: string, eventBus?: EventBus];

const discoverAndLoadImpl = (
  configuredPaths: string[],
  ...[cwd, agentDir, eventBus]: DiscoverRest
): Promise<LoadExtensionsResult> =>
  platformRuntime.runPromise(
    unwrapForeign(
      Effect.gen(function* () {
        const { resolvedCwd, allPaths } = yield* fromPromise(() =>
          discoverExtensionPaths({
            configuredPaths,
            cwd,
            ...(agentDir === undefined ? {} : { agentDir }),
          }),
        );
        return yield* fromPromise(() => loadExtensions(allPaths, resolvedCwd, eventBus));
      }),
    ),
  );

export const discoverAndLoadExtensions: {
  (...rest: DiscoverRest): (configuredPaths: string[]) => Promise<LoadExtensionsResult>;
  (configuredPaths: string[], ...rest: DiscoverRest): Promise<LoadExtensionsResult>;
} = Fn.dual((args) => Array.isArray(args[0]), discoverAndLoadImpl);
