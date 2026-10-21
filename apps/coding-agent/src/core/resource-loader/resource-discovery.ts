import awaitingModule from "../awaiting.ts";
import type defaultResourceLoaderInternalTypes from "../default-resource-loader-internal.types.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import loader from "../extensions/loader.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import timings from "../timings.ts";

const { awaited } = awaitingModule;
const { clearExtensionCache } = loader;
const { resetTimings } = timings;

export default class ResourceDiscovery {
  private readonly owner: DefaultResourceLoader;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
  }

  *discover(options: resourceLoaderTypes.ResourceLoaderReloadOptions | undefined) {
    resetTimings("extensions");
    if (this.owner.loaded) {
      clearExtensionCache();
    }

    const { metadataByPath, resolvedPaths, cliExtensionPaths, preTrustExtensions } =
      yield* this.resolveConfiguredPaths(options);

    this.owner.skills.extensionSkillSourceInfos = new Map();
    this.owner.prompts.extensionPromptSourceInfos = new Map();
    this.owner.themes.extensionThemeSourceInfos = new Map();

    const enabledResources = (resources: packageManagerTypes.ResolvedResource[]) => {
      for (const r of resources) {
        if (!metadataByPath.has(r.path)) {
          metadataByPath.set(r.path, r.metadata);
        }
      }
      return resources.filter((r) => r.enabled);
    };
    const enabledPaths = (resources: packageManagerTypes.ResolvedResource[]): string[] =>
      enabledResources(resources).map((r) => r.path);

    const configuredExtensions = enabledPaths(resolvedPaths.extensions);
    const configuredSkills = yield* awaited(
      this.mapSkillPaths(enabledResources(resolvedPaths.skills), metadataByPath),
    );
    const configuredPrompts = enabledPaths(resolvedPaths.prompts);
    const configuredThemes = enabledPaths(resolvedPaths.themes);

    for (const r of [...cliExtensionPaths.extensions, ...cliExtensionPaths.skills])
      if (!metadataByPath.has(r.path))
        metadataByPath.set(r.path, { origin: "top-level", scope: "temporary", source: "cli" });

    const plan: defaultResourceLoaderInternalTypes.ResourcePlan = {
      extensions: {
        cli: enabledPaths(cliExtensionPaths.extensions),
        configured: configuredExtensions,
      },
      metadataByPath,
      preTrustExtensions,
      prompts: { cli: enabledPaths(cliExtensionPaths.prompts), configured: configuredPrompts },
      skills: { cli: enabledPaths(cliExtensionPaths.skills), configured: configuredSkills },
      themes: { cli: enabledPaths(cliExtensionPaths.themes), configured: configuredThemes },
    };
    return plan;
  }

  private mapSkillPaths(
    resources: packageManagerTypes.ResolvedResource[],
    metadataByPath: Map<string, packageManagerTypes.PathMetadata>,
  ): Promise<string[]> {
    return Promise.all(
      resources.map((resource) =>
        this.owner.environment.paths.mapSkillPath(resource, metadataByPath),
      ),
    );
  }

  private *resolveConfiguredPaths(
    options: resourceLoaderTypes.ResourceLoaderReloadOptions | undefined,
  ) {
    let preTrustExtensions: extensionsTypesTypes.LoadExtensionsResult | undefined;
    if (options?.resolveProjectTrust !== undefined) {
      preTrustExtensions = yield* awaited(
        this.owner.extensions.loading.loadProjectTrustExtensions(),
      );
      const projectTrusted = yield* awaited(
        options.resolveProjectTrust({
          extensionsResult: preTrustExtensions,
        }),
      );
      yield* awaited(
        this.owner.environment.settingsManager.persistence.setProjectTrusted(projectTrusted),
      );
    }

    yield* awaited(this.owner.environment.settingsManager.persistence.reload());
    const resolvedPaths = yield* awaited(
      this.owner.environment.packageManager.resolution.resolve(),
    );
    const cliExtensionPaths = yield* awaited(
      this.owner.environment.packageManager.resolution.resolveExtensionSources(
        this.owner.extensions.additionalExtensionPaths,
        {
          temporary: true,
        },
      ),
    );
    this.owner.environment.paths.resourceMetadataByPath = new Map();
    const metadataByPath = this.owner.environment.paths.resourceMetadataByPath;
    return { cliExtensionPaths, metadataByPath, preTrustExtensions, resolvedPaths };
  }
}
