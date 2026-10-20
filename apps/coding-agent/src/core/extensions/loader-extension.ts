import { Effect } from "effect";

import { resolvePath } from "../../utils/paths.ts";
import type { EventBus } from "../event-bus.ts";
import { causeMessage, fromPromise, pathOperations } from "../platform/index.ts";
import {
  createSyntheticSourceInfo,
  getSyntheticPathSource,
  isSyntheticPath,
} from "../source-info.ts";
import { time } from "../timings.ts";
import { createExtensionAPI } from "./loader-api.ts";
import type { ExtensionCacheToken } from "./loader-cache.ts";
import { loadExtensionModule } from "./loader-module.ts";
import type { Extension, ExtensionFactory, ExtensionRuntime } from "./types.ts";

function createExtension(extensionPath: string, resolvedPath: string): Extension {
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
    sourceInfo: createSyntheticSourceInfo(extensionPath, { source, baseDir }),
    tools: new Map(),
  };
}

interface InitializeInput {
  factory: ExtensionFactory;
  extensionPath: string;
  resolvedPath: string;
  cwd: string;
  eventBus: EventBus;
  runtime: ExtensionRuntime;
}

export const initializeExtension = Effect.fn("initializeExtension")(function* (
  input: InitializeInput,
) {
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

export interface LoadOutcome {
  extension: Extension | null;
  error: string | null;
}

interface LoadOneInput {
  extensionPath: string;
  cwd: string;
  eventBus: EventBus;
  runtime: ExtensionRuntime;
  cacheToken?: ExtensionCacheToken | undefined;
}

export const loadExtension = ({
  extensionPath,
  cwd,
  eventBus,
  runtime,
  cacheToken,
}: LoadOneInput) =>
  Effect.gen(function* () {
    const resolvedPath = resolvePath(extensionPath, cwd, { normalizeUnicodeSpaces: true });
    const factory = yield* loadExtensionModule({ cacheToken, extensionPath: resolvedPath });
    time(`${extensionPath} module import`, "extensions");
    if (factory === undefined) {
      return {
        error: `Extension does not export a valid factory function: ${extensionPath}`,
        extension: null,
      } as LoadOutcome;
    }
    const extension = yield* initializeExtension({
      cwd,
      eventBus,
      extensionPath,
      factory,
      resolvedPath,
      runtime,
    });
    return { error: null, extension } as LoadOutcome;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed({
        error: `Failed to load extension: ${causeMessage(cause)}`,
        extension: null,
      } as LoadOutcome),
    ),
  );
