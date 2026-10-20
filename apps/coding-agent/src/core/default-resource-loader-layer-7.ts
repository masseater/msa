import awaitingModule from "./awaiting.ts";
import DefaultResourceLoaderLayer6 from "./default-resource-loader-layer-6.ts";
import loader from "./extensions/loader.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";

const { clearExtensionCache } = loader;
const { awaited } = awaitingModule;

export default abstract class DefaultResourceLoaderLayer7 extends DefaultResourceLoaderLayer6 {
  protected *reloadPart1(options: resourceLoaderTypes.ResourceLoaderReloadOptions | undefined) {
    if (this.loaded) {
      clearExtensionCache();
    }

    let {
      metadataByPath,
      resolvedPaths,
      cliExtensionPaths,
      preTrustExtensions,
    }: {
      metadataByPath: Map<string, packageManagerTypes.PathMetadata>;
      resolvedPaths: packageManagerTypes.ResolvedPaths;
      cliExtensionPaths: packageManagerTypes.ResolvedPaths;
      preTrustExtensions:
        | import("./extensions/types-extension.ts").default.LoadExtensionsResult
        | undefined;
    } = yield* this.reloadPart1Part1(options);

    this.extensionSkillSourceInfos = new Map();
    this.extensionPromptSourceInfos = new Map();
    this.extensionThemeSourceInfos = new Map();

    const getEnabledResources = (
      resources: packageManagerTypes.ResolvedResource[],
    ): packageManagerTypes.ResolvedResource[] => {
      for (const r of resources) {
        if (!metadataByPath.has(r.path)) {
          metadataByPath.set(r.path, r.metadata);
        }
      }
      return resources.filter((r) => r.enabled);
    };

    const getEnabledPaths = (resources: packageManagerTypes.ResolvedResource[]): string[] =>
      getEnabledResources(resources).map((r) => r.path);
    const enabledExtensions = getEnabledPaths(resolvedPaths.extensions);
    const enabledSkillResources = getEnabledResources(resolvedPaths.skills);
    const enabledPrompts = getEnabledPaths(resolvedPaths.prompts);
    const enabledThemes = getEnabledPaths(resolvedPaths.themes);

    const enabledSkills = enabledSkillResources.map((resource) =>
      this.mapSkillPath(resource, metadataByPath),
    );
    return {
      cliExtensionPaths,
      enabledExtensions,
      enabledPrompts,
      enabledSkills,
      enabledThemes,
      getEnabledPaths,
      metadataByPath,
      preTrustExtensions,
    };
  }

  private *reloadPart1Part1(options: resourceLoaderTypes.ResourceLoaderReloadOptions | undefined) {
    let preTrustExtensions: extensionsTypesTypes.LoadExtensionsResult | undefined;
    if (options?.resolveProjectTrust !== undefined) {
      preTrustExtensions = yield* awaited(this.loadProjectTrustExtensions());
      const projectTrusted = yield* awaited(
        options.resolveProjectTrust({
          extensionsResult: preTrustExtensions,
        }),
      );
      this.settingsManager.setProjectTrusted(projectTrusted);
    }

    yield* awaited(this.settingsManager.reload());
    const resolvedPaths = yield* awaited(this.packageManager.resolve());
    const cliExtensionPaths = yield* awaited(
      this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
        temporary: true,
      }),
    );
    this.resourceMetadataByPath = new Map();
    const metadataByPath = this.resourceMetadataByPath;
    return { cliExtensionPaths, metadataByPath, preTrustExtensions, resolvedPaths };
  }
}
