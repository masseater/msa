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
    path: extensionPath,
    resolvedPath,
    sourceInfo: createSyntheticSourceInfo(extensionPath, { source, baseDir }),
    handlers: new Map(),
    tools: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
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
  const load = createExtensionAPI({ extension, runtime, cwd, eventBus });
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
    const factory = yield* loadExtensionModule({ extensionPath: resolvedPath, cacheToken });
    time(`${extensionPath} module import`, "extensions");
    if (factory === undefined) {
      return {
        extension: null,
        error: `Extension does not export a valid factory function: ${extensionPath}`,
      } as LoadOutcome;
    }
    const extension = yield* initializeExtension({
      factory,
      extensionPath,
      resolvedPath,
      cwd,
      eventBus,
      runtime,
    });
    return { extension, error: null } as LoadOutcome;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed({
        extension: null,
        error: `Failed to load extension: ${causeMessage(cause)}`,
      } as LoadOutcome),
    ),
  );
