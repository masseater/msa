import type extensionsTypes from "../../../core/extensions/index.types.ts";
import type resourceLoaderTypes from "../../../core/resource-loader.types.ts";
import slashCommandsModule from "../../../core/slash-commands.ts";
import type sourceInfoTypes from "../../../core/source-info.types.ts";
import expandableTextSupport from "../components/expandable-text-support.ts";
import type InteractiveMode from "../interactive-mode.ts";
import loadedResources from "../loaded-resources.ts";

const { getStartupVisibility, renderLoadedResources } = loadedResources;
const { isBuiltinSlashCommandName } = slashCommandsModule;
const { isExpandable } = expandableTextSupport;

export default class LoadedResourcesView {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  toolOutputExpanded = false;

  isStartupExpanded(): boolean {
    return this.mode.options.verbose === true || this.toolOutputExpanded;
  }

  getStartupVisibility(): { header: boolean; details: boolean } {
    return getStartupVisibility(
      this.mode.settingsManager.display.getQuietStartup(),
      this.mode.options.verbose === true,
    );
  }

  toggleToolOutputExpansion(): void {
    this.setToolsExpanded(!this.toolOutputExpanded);
  }

  setToolsExpanded(expanded: boolean): void {
    if (expanded === this.toolOutputExpanded) return;

    this.toolOutputExpanded = expanded;
    const activeHeader = this.mode.layout.customHeader ?? this.mode.layout.builtInHeader;
    if (isExpandable(activeHeader)) {
      activeHeader.setExpanded(expanded);
    }
    for (const container of [
      this.mode.layout.loadedResourcesContainer,
      this.mode.layout.chatContainer,
    ]) {
      for (const child of container.children) {
        if (isExpandable(child)) {
          child.setExpanded(expanded);
        }
      }
    }
    this.mode.display.status.showStatus(`Tool output: ${expanded ? "expanded" : "collapsed"}`);
  }

  private getBuiltInCommandConflictDiagnostics(
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

  showLoadedResources(options?: {
    extensions?: Array<{ path: string; sourceInfo?: sourceInfoTypes.SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void {
    const showListing = options?.force === true || this.getStartupVisibility().details;
    const runner = this.mode.session.extensions.binding.extensionRunner;
    renderLoadedResources(
      this.mode.layout.loadedResourcesContainer,
      {
        extensionRunnerDiagnostics: [
          ...runner.getCommandDiagnostics(),
          ...this.getBuiltInCommandConflictDiagnostics(runner),
          ...runner.getShortcutDiagnostics(),
        ],
        promptTemplates: this.mode.session.promptTemplates,
        resourceLoader: this.mode.session.resourceLoader,
      },
      {
        cwd: this.mode.sessionManager.getCwd(),
        expanded: this.isStartupExpanded(),
        extensions: options?.extensions,
        showDiagnostics: showListing || options?.showDiagnosticsWhenQuiet === true,
        showListing,
      },
    );
  }
}
