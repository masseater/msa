import { Effect, Function as Fn } from "effect";

import paths from "../../utils/paths.ts";
import type eventBusTypes from "../event-bus.types.ts";
import platform from "../platform/index.ts";
import sourceInfoModule from "../source-info.ts";
import timings from "../timings.ts";
import loaderApi from "./loader-api.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { createSyntheticSourceInfo, getSyntheticPathSource, isSyntheticPath } = sourceInfoModule;
const { fromPromise, unwrapForeign } = platform;
const { resolvePath } = paths;
const { createExtensionAPI } = loaderApi;
const { time } = timings;

function createExtension(
  extensionPath: string,
  resolvedPath: string,
): extensionsTypesTypes.Extension {
  const source = getSyntheticPathSource(extensionPath) ?? "local";
  const baseDir = isSyntheticPath(extensionPath) ? undefined : platform.dirname(resolvedPath);

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

const loadExtensionFromFactoryImpl = (
  factory: extensionsTypesTypes.ExtensionFactory,
  cwd: string,
  eventBus: eventBusTypes.EventBus,
  runtime: extensionsTypesTypes.ExtensionRuntime,
  extensionPath = "<inline>",
): Promise<extensionsTypesTypes.Extension> =>
  Effect.runPromise(
    unwrapForeign(
      initializeExtension({
        cwd: resolvePath(cwd),
        eventBus,
        extensionPath,
        factory,
        resolvedPath: extensionPath,
        runtime,
      }),
    ),
  );

const loadExtensionFromFactory: {
  (
    cwd: string,
    eventBus: eventBusTypes.EventBus,
    runtime: extensionsTypesTypes.ExtensionRuntime,
    extensionPath?: string,
  ): (factory: extensionsTypesTypes.ExtensionFactory) => Promise<extensionsTypesTypes.Extension>;
  (
    factory: extensionsTypesTypes.ExtensionFactory,
    cwd: string,
    eventBus: eventBusTypes.EventBus,
    runtime: extensionsTypesTypes.ExtensionRuntime,
    extensionPath?: string,
  ): Promise<extensionsTypesTypes.Extension>;
} = Fn.dual((args) => typeof args[0] === "function", loadExtensionFromFactoryImpl);

const loaderFactory = { initializeExtension, loadExtensionFromFactory };

export default loaderFactory;
