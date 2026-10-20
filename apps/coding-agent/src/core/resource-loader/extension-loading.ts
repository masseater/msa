import * as Effect from "effect/Effect";

import pathsModule from "../../utils/paths.ts";
import awaitingModule from "../awaiting.ts";
import defaultResourceLoaderHelpers from "../default-resource-loader-helpers.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import loader from "../extensions/loader.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import sourceInfoModule from "../source-info.ts";
import addExtensionConflictDiagnostics from "./extension-conflicts.ts";

const { isSyntheticPath, BUILTIN_PATH_PREFIX } = sourceInfoModule;
const { resolvePath } = pathsModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { loadExtensionFromFactory, loadExtensionsCached } = loader;
const { collectExtensionPackageWarnings, mergeExtensionWarnings, omitReplacedExtensions } =
  defaultResourceLoaderHelpers;

export default class ExtensionLoading {
  private readonly owner: DefaultResourceLoader;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
  }

  resolveExtensionLoadPath(path: string): string {
    return isSyntheticPath(path)
      ? path
      : resolvePath(path, this.owner.environment.cwd, { normalizeUnicodeSpaces: true });
  }

  loadProjectTrustExtensions(): Promise<extensionsTypesTypes.LoadExtensionsResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.owner.environment.settingsManager.persistence.setProjectTrusted(false);
        yield* awaited(this.owner.environment.settingsManager.persistence.reload());
        return yield* performed(this.loadCurrentExtensionSet());
      }, this),
    );
  }

  private *currentExtensionPaths() {
    const { packageManager, paths } = this.owner.environment;
    const resolvedPaths = yield* awaited(packageManager.resolution.resolve());
    const cliExtensionPaths = yield* awaited(
      packageManager.resolution.resolveExtensionSources(
        this.owner.extensions.additionalExtensionPaths,
        { temporary: true },
      ),
    );
    const enabled = (resources: packageManagerTypes.ResolvedResource[]) =>
      resources.filter((r) => r.enabled).map((r) => r.path);
    const cliEnabled = enabled(cliExtensionPaths.extensions);
    const extensionPaths = (
      this.owner.extensions.noExtensions
        ? cliEnabled
        : paths.mergePaths(cliEnabled, enabled(resolvedPaths.extensions))
    ).filter((path) => !path.startsWith(BUILTIN_PATH_PREFIX));
    const metadataByPath = new Map(
      [...resolvedPaths.extensions, ...cliExtensionPaths.extensions].map((resource) => [
        resource.path,
        resource.metadata,
      ]),
    );
    return { extensionPaths, metadataByPath };
  }

  private loadCurrentExtensionSet(): Effect.Effect<extensionsTypesTypes.LoadExtensionsResult> {
    return awaitingWith(function* () {
      const { extensionPaths, metadataByPath } = yield* this.currentExtensionPaths();
      const packageWarnings = collectExtensionPackageWarnings(extensionPaths, metadataByPath);
      const { cwd, eventBus } = this.owner.environment;
      const extensionsResult = yield* awaited(loadExtensionsCached(extensionPaths, cwd, eventBus));
      mergeExtensionWarnings(extensionsResult, packageWarnings);
      const inlineExtensions = yield* performed(
        this.loadExtensionFactories(extensionsResult.runtime),
      );
      extensionsResult.extensions.push(...inlineExtensions.extensions);
      extensionsResult.errors.push(...inlineExtensions.errors);
      const replacementWarnings: Array<{ path: string; warning: string }> = [];
      extensionsResult.extensions = omitReplacedExtensions(
        extensionsResult.extensions,
        replacementWarnings,
      );
      mergeExtensionWarnings(extensionsResult, replacementWarnings);
      return extensionsResult;
    }, this);
  }

  private loadExtensionPaths(
    paths: string[],
    runtime?: extensionsTypesTypes.ExtensionRuntime,
  ): Effect.Effect<extensionsTypesTypes.LoadExtensionsResult> {
    return awaitingWith(function* () {
      const isBuiltinPath = (path: string) => path.startsWith(BUILTIN_PATH_PREFIX);
      const result = yield* awaited(
        loadExtensionsCached(
          paths.filter((path) => !isBuiltinPath(path)),
          this.owner.environment.cwd,
          this.owner.environment.eventBus,
          runtime,
        ),
      );
      for (const path of paths.filter(isBuiltinPath)) {
        const builtin = this.owner.environment.builtinExtensions.get(
          path.slice(BUILTIN_PATH_PREFIX.length),
        );
        if (builtin === undefined) {
          result.errors.push({ error: `Unknown built-in extension: ${path}`, path });
          continue;
        }
        try {
          const extension = yield* awaited(
            loadExtensionFromFactory(
              builtin.factory,
              this.owner.environment.cwd,
              this.owner.environment.eventBus,
              result.runtime,
              path,
            ),
          );
          extension.hidden = true;
          extension.replaceable = builtin.replaceable === true;
          result.extensions.push(extension);
        } catch (error) {
          result.errors.push({
            error: error instanceof Error ? error.message : "failed to load extension",
            path,
          });
        }
      }
      return result;
    }, this);
  }

  loadFinalExtensionSet(
    extensionPaths: string[],
    preTrustExtensions: extensionsTypesTypes.LoadExtensionsResult | undefined,
  ): Effect.Effect<extensionsTypesTypes.LoadExtensionsResult> {
    return awaitingWith(function* () {
      const preloadedByPath = new Map(
        (preTrustExtensions?.extensions ?? [])
          .filter((extension) => !extension.path.startsWith("<inline:"))
          .map((extension) => [extension.resolvedPath, extension]),
      );
      const remainingExtensions = yield* this.loadExtensionsNotPreloaded(
        preTrustExtensions,
        extensionPaths,
        preloadedByPath,
      );
      const loadedByPath = new Map(preloadedByPath);
      for (const extension of remainingExtensions.extensions) {
        loadedByPath.set(extension.resolvedPath, extension);
      }

      const inlineExtensions = yield* this.inlineExtensionsFor(
        preTrustExtensions,
        remainingExtensions.runtime,
      );
      const orderedExtensions = extensionPaths
        .map((path) => loadedByPath.get(this.resolveExtensionLoadPath(path)))
        .filter(
          (extension): extension is extensionsTypesTypes.Extension => extension !== undefined,
        );
      orderedExtensions.push(...inlineExtensions.extensions);

      const replacementWarnings: Array<{ path: string; warning: string }> = [];
      const extensionsResult: extensionsTypesTypes.LoadExtensionsResult = {
        errors: [
          ...(preTrustExtensions?.errors ?? []),
          ...remainingExtensions.errors,
          ...inlineExtensions.errors,
        ],
        extensions: omitReplacedExtensions(orderedExtensions, replacementWarnings),
        runtime: remainingExtensions.runtime,
        warnings: [
          ...(preTrustExtensions?.warnings ?? []),
          ...(remainingExtensions.warnings ?? []),
        ],
      };
      mergeExtensionWarnings(extensionsResult, replacementWarnings);
      addExtensionConflictDiagnostics(extensionsResult);
      return extensionsResult;
    }, this);
  }

  private *inlineExtensionsFor(
    preTrustExtensions: extensionsTypesTypes.LoadExtensionsResult | undefined,
    runtime: extensionsTypesTypes.ExtensionRuntime,
  ) {
    if (preTrustExtensions === undefined) {
      return yield* performed(this.loadExtensionFactories(runtime));
    }
    return {
      errors: [],
      extensions: preTrustExtensions.extensions.filter((extension) =>
        extension.path.startsWith("<inline:"),
      ),
    };
  }

  private *loadExtensionsNotPreloaded(
    preTrustExtensions: extensionsTypesTypes.LoadExtensionsResult | undefined,
    extensionPaths: string[],
    preloadedByPath: Map<string, extensionsTypesTypes.Extension>,
  ) {
    const failedPreloadPaths = new Set(
      (preTrustExtensions?.errors ?? []).map((error) => this.resolveExtensionLoadPath(error.path)),
    );
    const remainingPaths = extensionPaths.filter((path) => {
      const resolvedPath = this.resolveExtensionLoadPath(path);
      return !preloadedByPath.has(resolvedPath) && !failedPreloadPaths.has(resolvedPath);
    });
    const remainingExtensions = yield* performed(
      this.loadExtensionPaths(remainingPaths, preTrustExtensions?.runtime),
    );
    return remainingExtensions;
  }

  private loadExtensionFactories(runtime: extensionsTypesTypes.ExtensionRuntime): Effect.Effect<{
    extensions: extensionsTypesTypes.Extension[];
    errors: Array<{ path: string; error: string }>;
  }> {
    return awaitingWith(function* () {
      const extensions: extensionsTypesTypes.Extension[] = [];
      const errors: Array<{ path: string; error: string }> = [];

      for (const [index, input] of this.owner.environment.extensionFactories.entries()) {
        const isNamed = typeof input !== "function";
        const factory = isNamed ? input.factory : input;
        const extensionPath = `<inline:${isNamed ? input.name : index + 1}>`;
        try {
          const extension = yield* awaited(
            loadExtensionFromFactory(
              factory,
              this.owner.environment.cwd,
              this.owner.environment.eventBus,
              runtime,
              extensionPath,
            ),
          );
          extension.hidden = isNamed && input.hidden === true;
          extension.replaceable = isNamed && input.replaceable === true;
          extensions.push(extension);
        } catch (error) {
          const message = error instanceof Error ? error.message : "failed to load extension";
          errors.push({ error: message, path: extensionPath });
        }
      }

      return { errors, extensions };
    }, this);
  }
}
