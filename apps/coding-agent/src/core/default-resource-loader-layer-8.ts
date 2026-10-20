import * as Effect from "effect/Effect";

import pathsModule from "../utils/paths.ts";
import awaitingModule from "./awaiting.ts";
import defaultResourceLoaderHelpers from "./default-resource-loader-helpers.ts";
import DefaultResourceLoaderLayer7 from "./default-resource-loader-layer-7.ts";
import type typesExtensionTypes from "./extensions/types-extension.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import nodeFs from "./platform/node/fs.ts";
import resourceLoader from "./resource-loader.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import sourceInfoModule from "./source-info.ts";
import timings from "./timings.ts";

const { awaitingWith, performed } = awaitingModule;
const { resetTimings } = timings;
const { BUILTIN_PATH_PREFIX } = sourceInfoModule;
const { isLocalPath, resolvePath } = pathsModule;
const { existsSync } = nodeFs;
const { loadProjectContextFiles } = resourceLoader;
const { collectExtensionPackageWarnings, mergeExtensionWarnings, resolvePromptInput } =
  defaultResourceLoaderHelpers;

export default abstract class DefaultResourceLoaderLayer8 extends DefaultResourceLoaderLayer7 {
  reload(options?: resourceLoaderTypes.ResourceLoaderReloadOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        resetTimings("extensions");

        let {
          cliExtensionPaths,
          metadataByPath,
          getEnabledPaths,
          enabledExtensions,
          preTrustExtensions,
          enabledSkills,
          enabledPrompts,
          enabledThemes,
        }: {
          cliExtensionPaths: packageManagerTypes.ResolvedPaths;
          metadataByPath: Map<string, packageManagerTypes.PathMetadata>;
          getEnabledPaths: (resources: packageManagerTypes.ResolvedResource[]) => string[];
          enabledExtensions: string[];
          preTrustExtensions: typesExtensionTypes.LoadExtensionsResult | undefined;
          enabledSkills: string[];
          enabledPrompts: string[];
          enabledThemes: string[];
        } = yield* this.reloadPart1(options);

        for (const r of cliExtensionPaths.extensions) {
          if (!metadataByPath.has(r.path)) {
            metadataByPath.set(r.path, { origin: "top-level", scope: "temporary", source: "cli" });
          }
        }
        for (const r of cliExtensionPaths.skills) {
          if (!metadataByPath.has(r.path)) {
            metadataByPath.set(r.path, { origin: "top-level", scope: "temporary", source: "cli" });
          }
        }

        const cliEnabledExtensions = getEnabledPaths(cliExtensionPaths.extensions);
        const cliEnabledSkills = getEnabledPaths(cliExtensionPaths.skills);
        const cliEnabledPrompts = getEnabledPaths(cliExtensionPaths.prompts);
        const cliEnabledThemes = getEnabledPaths(cliExtensionPaths.themes);

        const extensionPaths = (
          this.noExtensions
            ? cliEnabledExtensions
            : this.mergePaths(cliEnabledExtensions, enabledExtensions)
        ).filter(
          (path) =>
            !path.startsWith(BUILTIN_PATH_PREFIX) ||
            !this.disabledBuiltinExtensions.has(path.slice(BUILTIN_PATH_PREFIX.length)),
        );

        const packageWarnings = collectExtensionPackageWarnings(extensionPaths, metadataByPath);
        const extensionsResult = yield* performed(
          this.loadFinalExtensionSet(extensionPaths, preTrustExtensions),
        );
        mergeExtensionWarnings(extensionsResult, packageWarnings);
        for (const p of this.additionalExtensionPaths) {
          if (isLocalPath(p)) {
            const resolved = this.resolveResourcePath(p);
            if (!existsSync(resolved)) {
              extensionsResult.errors.push({
                error: `Extension path does not exist: ${resolved}`,
                path: resolved,
              });
            }
          }
        }
        this.extensionsResult =
          this.extensionsOverride === undefined
            ? extensionsResult
            : this.extensionsOverride(extensionsResult);
        this.applyExtensionSourceInfo(this.extensionsResult.extensions, metadataByPath);

        const skillPaths = this.noSkills
          ? this.mergePaths(cliEnabledSkills, this.additionalSkillPaths)
          : this.mergePaths([...cliEnabledSkills, ...enabledSkills], this.additionalSkillPaths);

        this.lastSkillPaths = skillPaths;
        this.updateSkillsFromPaths(skillPaths, metadataByPath);
        for (const p of this.additionalSkillPaths) {
          if (isLocalPath(p)) {
            const resolved = this.resolveResourcePath(p);
            if (!existsSync(resolved) && !this.skillDiagnostics.some((d) => d.path === resolved)) {
              this.skillDiagnostics.push({
                message: "Skill path does not exist",
                path: resolved,
                type: "error",
              });
            }
          }
        }

        const promptPaths = this.noPromptTemplates
          ? this.mergePaths(cliEnabledPrompts, this.additionalPromptTemplatePaths)
          : this.mergePaths(
              [...cliEnabledPrompts, ...enabledPrompts],
              this.additionalPromptTemplatePaths,
            );

        this.lastPromptPaths = promptPaths;
        this.updatePromptsFromPaths(promptPaths, metadataByPath);
        for (const p of this.additionalPromptTemplatePaths) {
          if (isLocalPath(p)) {
            const resolved = this.resolveResourcePath(p);
            if (!existsSync(resolved) && !this.promptDiagnostics.some((d) => d.path === resolved)) {
              this.promptDiagnostics.push({
                message: "Prompt template path does not exist",
                path: resolved,
                type: "error",
              });
            }
          }
        }

        const themePaths = this.noThemes
          ? this.mergePaths(cliEnabledThemes, this.additionalThemePaths)
          : this.mergePaths([...cliEnabledThemes, ...enabledThemes], this.additionalThemePaths);

        this.lastThemePaths = themePaths;
        this.updateThemesFromPaths(themePaths, metadataByPath);
        for (const p of this.additionalThemePaths) {
          const resolved = this.resolveResourcePath(p);
          if (!existsSync(resolved) && !this.themeDiagnostics.some((d) => d.path === resolved)) {
            this.themeDiagnostics.push({
              message: "Theme path does not exist",
              path: resolved,
              type: "error",
            });
          }
        }

        const agentsFiles = {
          agentsFiles: this.noContextFiles
            ? []
            : loadProjectContextFiles({
                agentDir: this.agentDir,
                cwd: this.cwd,
              }),
        };
        const resolvedAgentsFiles =
          this.agentsFilesOverride === undefined
            ? agentsFiles
            : this.agentsFilesOverride(agentsFiles);
        this.agentsFiles = resolvedAgentsFiles.agentsFiles;

        const systemPromptSource = this.systemPromptSource ?? this.discoverSystemPromptFile();
        const baseSystemPrompt = resolvePromptInput(systemPromptSource, "system prompt");
        this.systemPrompt =
          this.systemPromptOverride === undefined
            ? baseSystemPrompt
            : this.systemPromptOverride(baseSystemPrompt);
        this.systemPromptSourcePath =
          systemPromptSource !== undefined &&
          systemPromptSource !== "" &&
          existsSync(systemPromptSource)
            ? resolvePath(systemPromptSource)
            : undefined;

        let appendSources = this.appendSystemPromptSource;
        if (appendSources === undefined) {
          const discoveredAppendSystemPromptFile = this.discoverAppendSystemPromptFile();
          appendSources =
            discoveredAppendSystemPromptFile !== undefined &&
            discoveredAppendSystemPromptFile !== ""
              ? [discoveredAppendSystemPromptFile]
              : [];
        }
        const baseAppend = appendSources
          .map((s) => resolvePromptInput(s, "append system prompt"))
          .filter((s): s is string => s !== undefined);
        this.appendSystemPrompt =
          this.appendSystemPromptOverride === undefined
            ? baseAppend
            : this.appendSystemPromptOverride(baseAppend);
        this.appendSystemPromptSourcePaths = appendSources
          .filter((source) => existsSync(source))
          .map((source) => resolvePath(source));
        this.loaded = true;
      }, this),
    );
  }
}
