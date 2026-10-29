import awaitingModule from "../awaiting.ts";
import defaultResourceLoaderHelpers from "../default-resource-loader-helpers.ts";
import type defaultResourceLoaderInternalTypes from "../default-resource-loader-internal.types.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import loader from "../extensions/loader.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import sourceInfoModule from "../source-info.ts";
import ExtensionLoading from "./extension-loading.ts";

const { BUILTIN_PATH_PREFIX } = sourceInfoModule;
const { awaited, performed } = awaitingModule;
const { createExtensionRuntime } = loader;
const { collectExtensionPackageWarnings, mergeExtensionWarnings } = defaultResourceLoaderHelpers;

export default class ExtensionResources {
  private readonly owner: DefaultResourceLoader;

  readonly loading: ExtensionLoading;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
    this.loading = new ExtensionLoading(owner);
  }

  additionalExtensionPaths: string[] = [];

  noExtensions = false;

  disabledBuiltinExtensions = new Set<string>();

  extensionsOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["extensionsOverride"];

  extensionsResult: extensionsTypesTypes.LoadExtensionsResult = {
    errors: [],
    extensions: [],
    runtime: createExtensionRuntime(() =>
      this.owner.environment.settingsManager.getGlobalSettings(),
    ),
  };

  normalizeExtensionPaths(
    entries: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>,
  ): Array<{ path: string; metadata: packageManagerTypes.PathMetadata }> {
    return entries.map((entry) => {
      const metadata =
        entry.metadata.baseDir !== undefined && entry.metadata.baseDir !== ""
          ? {
              ...entry.metadata,
              baseDir: this.owner.environment.paths.resolveResourcePath(entry.metadata.baseDir),
            }
          : entry.metadata;
      return {
        metadata,
        path: this.owner.environment.paths.resolveResourcePath(entry.path),
      };
    });
  }

  applyExtensionSourceInfo(
    extensions: extensionsTypesTypes.Extension[],
    metadataByPath: Map<string, packageManagerTypes.PathMetadata>,
  ): Promise<void> {
    const { paths } = this.owner.environment;
    return Promise.all(
      extensions.map((extension) => {
        const known = paths.findSourceInfoForPath(extension.path, undefined, metadataByPath);
        return (
          known === undefined
            ? paths.getDefaultSourceInfoForPath(extension.path)
            : Promise.resolve(known)
        ).then((sourceInfo) => {
          extension.sourceInfo = sourceInfo;
          for (const command of extension.commands.values()) command.sourceInfo = sourceInfo;
          for (const tool of extension.tools.values()) tool.sourceInfo = sourceInfo;
          return undefined;
        });
      }),
    ).then(() => undefined);
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
    this.noExtensions = options.noExtensions ?? false;
    this.disabledBuiltinExtensions = new Set(options.disabledBuiltinExtensions);
    this.extensionsOverride = options.extensionsOverride;
  }

  *reload(plan: defaultResourceLoaderInternalTypes.ResourcePlan) {
    const { paths } = this.owner.environment;
    const { cli, configured } = plan.extensions;
    const extensionPaths = (
      this.noExtensions ? cli : yield* awaited(paths.mergePaths(cli, configured))
    ).filter(
      (path) =>
        !path.startsWith(BUILTIN_PATH_PREFIX) ||
        !this.disabledBuiltinExtensions.has(path.slice(BUILTIN_PATH_PREFIX.length)),
    );
    const packageWarnings = yield* awaited(
      collectExtensionPackageWarnings(extensionPaths, plan.metadataByPath),
    );
    const extensionsResult = yield* performed(
      this.loading.loadFinalExtensionSet(extensionPaths, plan.preTrustExtensions),
    );
    mergeExtensionWarnings(extensionsResult, packageWarnings);
    for (const resolved of yield* awaited(
      paths.missingPaths(this.additionalExtensionPaths, true),
    )) {
      extensionsResult.errors.push({
        error: `Extension path does not exist: ${resolved}`,
        path: resolved,
      });
    }
    this.extensionsResult =
      this.extensionsOverride === undefined
        ? extensionsResult
        : this.extensionsOverride(extensionsResult);
    yield* awaited(
      this.applyExtensionSourceInfo(this.extensionsResult.extensions, plan.metadataByPath),
    );
  }
}
