import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import ResourceListing from "./loaded-resources/resource-listing.ts";

type Source = loadedResourcesTypes.LoadedResourcesSource;
type Options = loadedResourcesTypes.LoadedResourcesOptions;

const getStartupVisibility: {
  (verbose: boolean): (quietStartup: settingsManagerTypes.QuietStartup | undefined) => {
    header: boolean;
    details: boolean;
  };
  (
    quietStartup: settingsManagerTypes.QuietStartup | undefined,
    verbose: boolean,
  ): { header: boolean; details: boolean };
} = dual(
  2,
  (
    quietStartup: settingsManagerTypes.QuietStartup | undefined,
    verbose: boolean,
  ): { header: boolean; details: boolean } => ({
    details: verbose || quietStartup === false,
    header: verbose || quietStartup !== true,
  }),
);

function loadResults(source: Source, options: Options) {
  const { resourceLoader } = source;
  const extensionsResult = resourceLoader.getExtensions();
  return {
    extensions:
      options.extensions ??
      extensionsResult.extensions
        .filter((extension) => extension.hidden !== true)
        .map((extension) => ({ path: extension.path, sourceInfo: extension.sourceInfo })),
    extensionsResult,
    promptsResult: resourceLoader.getPrompts(),
    skillsResult: resourceLoader.getSkills(),
    themesResult: resourceLoader.getThemes(),
  };
}

function collectSourceInfos(
  results: ReturnType<typeof loadResults>,
): Map<string, sourceInfoTypes.SourceInfo> {
  const sourceInfos = new Map<string, sourceInfoTypes.SourceInfo>();
  const add = (p: string | undefined, sourceInfo: sourceInfoTypes.SourceInfo | undefined) => {
    if (p !== undefined && p !== "" && sourceInfo !== undefined) sourceInfos.set(p, sourceInfo);
  };
  for (const extension of results.extensions) add(extension.path, extension.sourceInfo);
  for (const skill of results.skillsResult.skills) add(skill.filePath, skill.sourceInfo);
  for (const prompt of results.promptsResult.prompts) add(prompt.filePath, prompt.sourceInfo);
  for (const loadedTheme of results.themesResult.themes) {
    add(loadedTheme.sourcePath, loadedTheme.sourceInfo);
  }
  return sourceInfos;
}

function contextFiles(source: Source): { path: string }[] {
  const { resourceLoader } = source;
  const systemPromptSource = resourceLoader.getSystemPromptSource();
  return [
    ...(systemPromptSource === undefined ? [] : [systemPromptSource]),
    ...resourceLoader.getAppendSystemPromptSources(),
    ...resourceLoader.getAgentsFiles().agentsFiles,
  ];
}

const renderLoadedResources: {
  (source: Source, options: Options): (container: tuiTypes.Container) => void;
  (container: tuiTypes.Container, source: Source, options: Options): void;
} = dual(3, (container: tuiTypes.Container, source: Source, options: Options): void => {
  container.clear();
  if (!options.showListing && !options.showDiagnostics) return;
  const results = loadResults(source, options);
  const listing = new ResourceListing(container, options, collectSourceInfos(results));
  if (options.showListing) {
    listing.listContext(contextFiles(source));
    listing.listSkills(results.skillsResult.skills);
    listing.listPrompts(source.promptTemplates);
    listing.listExtensions(results.extensions);
  }
  if (options.showDiagnostics) {
    listing.addDiagnostics("Skill conflicts", results.skillsResult.diagnostics);
    listing.addDiagnostics("Prompt conflicts", results.promptsResult.diagnostics);
    listing.addDiagnostics("Extension issues", [
      ...results.extensionsResult.errors.map((error) => ({
        message: error.error,
        path: error.path,
        type: "error" as const,
      })),
      ...(results.extensionsResult.warnings ?? []).map((warning) => ({
        message: warning.warning,
        path: warning.path,
        type: "warning" as const,
      })),
      ...source.extensionRunnerDiagnostics,
    ]);
    listing.addDiagnostics("Theme conflicts", results.themesResult.diagnostics);
  }
});

const loadedResources = { getStartupVisibility, renderLoadedResources };

export default loadedResources;
