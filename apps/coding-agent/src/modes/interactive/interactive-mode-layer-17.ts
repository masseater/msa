import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import accounts from "../../core/accounts.ts";
import httpDispatcher from "../../core/http-dispatcher.ts";
import slashCommandsModule from "../../core/slash-commands.ts";
import type settingsSelectorTypes from "./components/settings-selector.types.ts";
import ToolExecutionComponent from "./components/tool-execution.ts";
import InteractiveModeLayer16 from "./interactive-mode-layer-16.ts";

const { BUILTIN_SLASH_COMMANDS, isBuiltinSlashCommandName, withSkillCommands } =
  slashCommandsModule;
const { CombinedAutocompleteProvider, TuiAltScreen } = tuiModule;
const { completeAccountsArgument } = accounts;
const { configureHttpDispatcher, formatHttpIdleTimeoutMs } = httpDispatcher;

export default abstract class InteractiveModeLayer17 extends InteractiveModeLayer16 {
  protected createBaseAutocompleteProvider(): tuiTypes.AutocompleteProvider {
    const { thinkingCommand, slashCommands } = this.createBaseAutocompleteProviderThinkingCommand();
    this.createBaseAutocompleteProviderPart2(thinkingCommand, slashCommands);

    const templateCommands: tuiTypes.SlashCommand[] = this.session.promptTemplates.map((cmd) => ({
      name: cmd.name,
      ...this.autocompleteDescription(cmd.description, cmd.sourceInfo),
      ...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
    }));

    const extensionCommands: tuiTypes.SlashCommand[] = this.session.extensionRunner
      .getRegisteredCommands()
      .filter((cmd) => !isBuiltinSlashCommandName(cmd.name))
      .map((cmd) => {
        const slashCommand: tuiTypes.SlashCommand = { name: cmd.invocationName };
        Object.assign(slashCommand, this.autocompleteDescription(cmd.description, cmd.sourceInfo));
        if (cmd.getArgumentCompletions !== undefined) {
          slashCommand.getArgumentCompletions = cmd.getArgumentCompletions;
        }
        return slashCommand;
      });

    this.skillCommands.clear();
    const skillCommandList: tuiTypes.SlashCommand[] = [];
    if (this.settingsManager.getEnableSkillCommands()) {
      for (const skill of this.session.resourceLoader.getSkills().skills) {
        this.skillCommands.set(skill.name, skill.filePath);
        skillCommandList.push({
          name: skill.name,
          ...this.autocompleteDescription(skill.description, skill.sourceInfo),
        });
      }
    }

    return new CombinedAutocompleteProvider(
      withSkillCommands(
        [...slashCommands, ...templateCommands, ...extensionCommands],
        skillCommandList,
      ),
      this.sessionManager.getCwd(),
      this.fdPath,
    );
  }

  protected createBaseAutocompleteProviderThinkingCommand(): {
    thinkingCommand: tuiTypes.SlashCommand | undefined;
    slashCommands: tuiTypes.SlashCommand[];
  } {
    const slashCommands: tuiTypes.SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => {
      const slashCommand: tuiTypes.SlashCommand = {
        description:
          command.aliases === undefined
            ? command.description
            : `${command.description} (${command.aliases.map((alias) => `/${alias}`).join(", ")})`,
        name: command.name,
      };
      if (command.argumentHint !== undefined && command.argumentHint !== "") {
        slashCommand.argumentHint = command.argumentHint;
      }
      return slashCommand;
    });

    const modelCommand = slashCommands.find((command) => command.name === "model");
    if (modelCommand !== undefined)
      modelCommand.getArgumentCompletions = (prefix) => this.modelArgumentCompletions(prefix);

    const accountsCommand = slashCommands.find((command) => command.name === "accounts");
    if (accountsCommand !== undefined)
      accountsCommand.getArgumentCompletions = completeAccountsArgument;

    const thinkingCommand = slashCommands.find((command) => command.name === "effort");
    return { slashCommands, thinkingCommand };
  }

  protected setupAutocompleteProvider(): void {
    let provider = this.createBaseAutocompleteProvider();
    const triggerCharacters: string[] = [];
    for (const wrapProvider of this.autocompleteProviderWrappers) {
      provider = wrapProvider(provider);
      triggerCharacters.push(...(provider.triggerCharacters ?? []));
    }
    if (triggerCharacters.length > 0) {
      provider.triggerCharacters = [...new Set(triggerCharacters)];
    }

    this.autocompleteProvider = provider;
    this.defaultEditor.setAutocompleteProvider(provider);
    if (this.editor !== this.defaultEditor) {
      this.editor.setAutocompleteProvider?.(provider);
    }
  }

  protected refreshProvidersAfterAccounts(): Promise<void> {
    return this.session.modelRuntime
      .refresh({ allowNetwork: false })
      .then(() => this.setupAutocompleteProvider());
  }

  protected settingsCallbacks2() {
    return {
      onDefaultProjectTrustChange: (defaultProjectTrust) => {
        this.settingsManager.setDefaultProjectTrust(defaultProjectTrust);
      },
      onDoubleEscapeActionChange: (action) => {
        this.settingsManager.setDoubleEscapeAction(action);
      },
      onEditorPaddingXChange: (padding) => {
        this.settingsManager.setEditorPaddingX(padding);
        this.defaultEditor.setPaddingX(padding);
        if (this.editor !== this.defaultEditor && this.editor.setPaddingX !== undefined) {
          this.editor.setPaddingX(padding);
        }
      },
      onEnableInstallTelemetryChange: (enabled) => {
        this.settingsManager.setEnableInstallTelemetry(enabled);
      },
      onEnableSkillCommandsChange: (enabled) => {
        this.settingsManager.setEnableSkillCommands(enabled);
        this.setupAutocompleteProvider();
      },
      onFollowUpModeChange: (mode) => {
        this.session.setFollowUpMode(mode);
      },
      onFullscreenCopyOnSelectChange: (enabled) => {
        this.settingsManager.setFullscreenCopyOnSelect(enabled);
        if (this.renderer instanceof TuiAltScreen) this.renderer.setCopyOnSelect(enabled);
      },
      onFullscreenExitOutputChange: (output) => {
        this.settingsManager.setFullscreenExitOutput(output);
      },
      onFullscreenScrollbarChange: (mode) => {
        this.settingsManager.setFullscreenScrollbar(mode);
        this.applyFullscreenScrollbarSetting();
      },
      onFullscreenWheelScrollLinesChange: (lines) => {
        this.settingsManager.setFullscreenWheelScrollLines(lines);
        if (this.renderer instanceof TuiAltScreen) this.renderer.setWheelScrollLines(lines);
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  protected settingsCallbacks3() {
    return {
      onHideThinkingBlockChange: (hidden) => {
        this.hideThinkingBlock = hidden;
        this.settingsManager.setHideThinkingBlock(hidden);
        this.updateThinkingBlockVisibility();
      },
      onHttpIdleTimeoutMsChange: (timeoutMs) => {
        this.settingsManager.setHttpIdleTimeoutMs(timeoutMs);
        configureHttpDispatcher(timeoutMs);
        this.showStatus(`HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`);
      },
      onImageWidthCellsChange: (width) => {
        this.settingsManager.setImageWidthCells(width);
        for (const child of this.chatComponents()) {
          if (child instanceof ToolExecutionComponent) {
            child.setImageWidthCells(width);
          }
        }
      },
      onMermaidRenderingModeChange: (mode) => {
        this.settingsManager.setMermaidRenderingMode(mode);
        this.chatContainer.invalidate();
        this.ui.requestRender();
      },
      onModelThinkingLevelChange: (provider, modelId, level) => {
        this.settingsManager.setModelThinkingLevel(provider, modelId, level);
        const current = this.session.model;
        if (current !== undefined && current.provider === provider && current.id === modelId) {
          this.session.setThinkingLevel(level);
          this.footer.invalidate();
          this.updateEditorBorderColor();
        }
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }
}
