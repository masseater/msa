import { Effect } from "effect";

import paths from "../../utils/paths.ts";
import type eventBusTypes from "../event-bus.types.ts";
import platform from "../platform/index.ts";
import timings from "../timings.ts";
import type loaderCacheTypes from "./loader-cache.types.ts";
import type loaderExtensionTypes from "./loader-extension.types.ts";
import loaderFactory from "./loader-factory.ts";
import loaderModule from "./loader-module.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { causeMessage } = platform;
const { initializeExtension } = loaderFactory;
const { time } = timings;
const { resolvePath } = paths;
const { loadExtensionModule } = loaderModule;

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

const loaderExtension = { loadExtension };

export default loaderExtension;
