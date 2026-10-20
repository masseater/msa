import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import defaultResourceLoaderHelpers from "./default-resource-loader-helpers.ts";
import DefaultResourceLoaderLayer4 from "./default-resource-loader-layer-4.ts";
import loader from "./extensions/loader.ts";
import type typesExtensionTypes from "./extensions/types-extension.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import sourceInfoModule from "./source-info.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { BUILTIN_PATH_PREFIX } = sourceInfoModule;
const { loadExtensionFromFactory, loadExtensionsCached } = loader;
const { collectExtensionPackageWarnings, mergeExtensionWarnings, omitReplacedExtensions } =
  defaultResourceLoaderHelpers;

export default abstract class DefaultResourceLoaderLayer5 extends DefaultResourceLoaderLayer4 {
  loadProjectTrustExtensions(): Promise<extensionsTypesTypes.LoadExtensionsResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.settingsManager.persistence.setProjectTrusted(false);
        yield* awaited(this.settingsManager.persistence.reload());
        return yield* performed(this.loadCurrentExtensionSet({ includeInlineFactories: true }));
      }, this),
    );
  }

  protected loadCurrentExtensionSet(options: {
    includeInlineFactories: boolean;
  }): Effect.Effect<extensionsTypesTypes.LoadExtensionsResult> {
    return awaitingWith(function* () {
      const resolvedPaths = yield* awaited(this.packageManager.resolution.resolve());
      const cliExtensionPaths = yield* awaited(
        this.packageManager.resolution.resolveExtensionSources(this.additionalExtensionPaths, {
          temporary: true,
        }),
      );
      const enabledExtensions = resolvedPaths.extensions
        .filter((r) => r.enabled)
        .map((r) => r.path);
      const cliEnabledExtensions = cliExtensionPaths.extensions
        .filter((r) => r.enabled)
        .map((r) => r.path);
      const extensionPaths = (
        this.noExtensions
          ? cliEnabledExtensions
          : this.mergePaths(cliEnabledExtensions, enabledExtensions)
      ).filter((path) => !path.startsWith(BUILTIN_PATH_PREFIX));
      const metadataByPath = new Map(
        [...resolvedPaths.extensions, ...cliExtensionPaths.extensions].map((resource) => [
          resource.path,
          resource.metadata,
        ]),
      );
      const packageWarnings = collectExtensionPackageWarnings(extensionPaths, metadataByPath);
      const extensionsResult = yield* awaited(
        loadExtensionsCached(extensionPaths, this.cwd, this.eventBus),
      );
      mergeExtensionWarnings(extensionsResult, packageWarnings);
      if (!options.includeInlineFactories) {
        return extensionsResult;
      }

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

  protected loadExtensionPaths(
    paths: string[],
    runtime?: extensionsTypesTypes.ExtensionRuntime,
  ): Effect.Effect<extensionsTypesTypes.LoadExtensionsResult> {
    return awaitingWith(function* () {
      const isBuiltinPath = (path: string) => path.startsWith(BUILTIN_PATH_PREFIX);
      const result = yield* awaited(
        loadExtensionsCached(
          paths.filter((path) => !isBuiltinPath(path)),
          this.cwd,
          this.eventBus,
          runtime,
        ),
      );
      for (const path of paths.filter(isBuiltinPath)) {
        const builtin = this.builtinExtensions.get(path.slice(BUILTIN_PATH_PREFIX.length));
        if (builtin === undefined) {
          result.errors.push({ error: `Unknown built-in extension: ${path}`, path });
          continue;
        }
        try {
          const extension = yield* awaited(
            loadExtensionFromFactory(
              builtin.factory,
              this.cwd,
              this.eventBus,
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

  protected loadFinalExtensionSet(
    extensionPaths: string[],
    preTrustExtensions: extensionsTypesTypes.LoadExtensionsResult | undefined,
  ): Effect.Effect<extensionsTypesTypes.LoadExtensionsResult> {
    return awaitingWith(function* () {
      const preloaded = preTrustExtensions?.extensions ?? [];
      const preloadedByPath = new Map(
        preloaded
          .filter((extension) => !extension.path.startsWith("<inline:"))
          .map((extension) => [extension.resolvedPath, extension]),
      );
      const remainingExtensions = yield* this.loadFinalExtensionSetPart1(
        preTrustExtensions,
        extensionPaths,
        preloadedByPath,
      );
      const loadedByPath = new Map(preloadedByPath);
      for (const extension of remainingExtensions.extensions) {
        loadedByPath.set(extension.resolvedPath, extension);
      }

      const inlineExtensions =
        preTrustExtensions === undefined
          ? yield* performed(this.loadExtensionFactories(remainingExtensions.runtime))
          : {
              errors: [],
              extensions: preloaded.filter((extension) => extension.path.startsWith("<inline:")),
            };
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
      this.addExtensionConflictDiagnostics(extensionsResult);
      return extensionsResult;
    }, this);
  }

  protected *loadFinalExtensionSetPart1(
    preTrustExtensions: typesExtensionTypes.LoadExtensionsResult | undefined,
    extensionPaths: string[],
    preloadedByPath: Map<string, typesExtensionTypes.Extension>,
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

  protected loadExtensionFactories(runtime: extensionsTypesTypes.ExtensionRuntime): Effect.Effect<{
    extensions: extensionsTypesTypes.Extension[];
    errors: Array<{ path: string; error: string }>;
  }> {
    return awaitingWith(function* () {
      const extensions: extensionsTypesTypes.Extension[] = [];
      const errors: Array<{ path: string; error: string }> = [];

      for (const [index, input] of this.extensionFactories.entries()) {
        const isNamed = typeof input !== "function";
        const factory = isNamed ? input.factory : input;
        const extensionPath = `<inline:${isNamed ? input.name : index + 1}>`;
        try {
          const extension = yield* awaited(
            loadExtensionFromFactory(factory, this.cwd, this.eventBus, runtime, extensionPath),
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
