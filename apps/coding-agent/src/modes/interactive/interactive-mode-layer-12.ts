import type extensionsTypes from "../../core/extensions/index.types.ts";
import modelPolicy from "../../core/model-policy.ts";
import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import slashCommandsModule from "../../core/slash-commands.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import git from "../../utils/git.ts";
import ModelSelectorComponent from "./components/model-selector.ts";
import InteractiveModeLayer11 from "./interactive-mode-layer-11.ts";
import loadedResources from "./loaded-resources.ts";

const { parseGitUrl } = git;
const { isBuiltinSlashCommandName } = slashCommandsModule;
const { renderLoadedResources } = loadedResources;
const { saveModelPolicy } = modelPolicy;

export default abstract class InteractiveModeLayer12 extends InteractiveModeLayer11 {
  protected getAutocompleteSourceTag(sourceInfo?: sourceInfoTypes.SourceInfo): string | undefined {
    if (sourceInfo === undefined || sourceInfo.source === "builtin") {
      return undefined;
    }

    const scopePrefix =
      sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
    const source = sourceInfo.source.trim();

    if (source === "auto" || source === "local" || source === "cli") {
      return scopePrefix;
    }

    if (source.startsWith("npm:")) {
      return `${scopePrefix}:${source}`;
    }

    const gitSource = parseGitUrl(source);
    if (gitSource !== null) {
      const ref = gitSource.ref !== undefined && gitSource.ref !== "" ? `@${gitSource.ref}` : "";
      return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
    }

    return scopePrefix;
  }

  protected autocompleteDescription(
    description: string | undefined,
    sourceInfo?: sourceInfoTypes.SourceInfo,
  ): { description?: string } {
    const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
    if (sourceTag === undefined || sourceTag === "") {
      return description === undefined ? {} : { description };
    }
    return {
      description:
        description !== undefined && description !== ""
          ? `[${sourceTag}] ${description}`
          : `[${sourceTag}]`,
    };
  }

  protected getBuiltInCommandConflictDiagnostics(
    extensionRunner: extensionsTypes.ExtensionRunner,
  ): resourceLoaderTypes.ResourceDiagnostic[] {
    return extensionRunner
      .getRegisteredCommands()
      .filter((command) => isBuiltinSlashCommandName(command.name))
      .map((command) => ({
        message:
          command.invocationName === command.name
            ? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
            : `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
        path: command.sourceInfo.path,
        type: "warning" as const,
      }));
  }

  protected showLoadedResources(options?: {
    extensions?: Array<{ path: string; sourceInfo?: sourceInfoTypes.SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void {
    const showListing = options?.force === true || this.getStartupVisibility().details;
    const runner = this.session.extensionRunner;
    renderLoadedResources(
      this.loadedResourcesContainer,
      {
        extensionRunnerDiagnostics: [
          ...runner.getCommandDiagnostics(),
          ...this.getBuiltInCommandConflictDiagnostics(runner),
          ...runner.getShortcutDiagnostics(),
        ],
        promptTemplates: this.session.promptTemplates,
        resourceLoader: this.session.resourceLoader,
      },
      {
        cwd: this.sessionManager.getCwd(),
        expanded: this.isStartupExpanded(),
        extensions: options?.extensions,
        showDiagnostics: showListing || options?.showDiagnosticsWhenQuiet === true,
        showListing,
      },
    );
  }

  protected showModelSelector(initialSearchInput?: string): void {
    this.editorSlot.showSelector((done) => {
      const runtime = this.session.modelRuntime;
      const selector = new ModelSelectorComponent(
        this.ui,
        this.session.model,
        runtime,
        this.session.scopedModels,
        (model) => this.selectModelFromSelector(model, false, done),
        () => {
          done();
          this.ui.requestRender();
        },
        initialSearchInput,
        (model) => this.selectModelFromSelector(model, true, done),
        this.configuredDefaultModel(),
        {
          getCatalogModels: () => runtime.getCatalogModels(),
          getPolicy: () => runtime.getModelPolicy(),
          savePolicy: (policy) =>
            saveModelPolicy(
              { modelRuntime: runtime, settingsManager: this.settingsManager },
              policy,
            ),
        },
      );
      return { component: selector, dispose: () => selector.dispose(), focus: selector };
    });
  }
}
