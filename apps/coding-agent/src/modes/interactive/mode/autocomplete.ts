import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import accounts from "../../../core/accounts.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import slashCommandsModule from "../../../core/slash-commands.ts";
import interactiveModeHelpers from "../interactive-mode-helpers.ts";
import type InteractiveMode from "../interactive-mode.ts";
import loginFlowSupport from "../login-flow-support.ts";
import modelSearch from "../model-search.ts";

const { slashCommandName, isBuiltinSlashCommandName, BUILTIN_SLASH_COMMANDS, withSkillCommands } =
  slashCommandsModule;
const { CombinedAutocompleteProvider } = tuiModule;
const { createFuzzyAutocompleteItems } = interactiveModeHelpers;
const { getModelSearchText } = modelSearch;
const {
  formatLoginProviderCompletionDescription,
  getLoginProviderCompletionOptions,
  getLoginProviderSearchText,
} = loginFlowSupport;
const { completeAccountsArgument } = accounts;

export default class AutocompleteSetup {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  autocompleteProvider!: tuiTypes.AutocompleteProvider | undefined;

  autocompleteProviderWrappers: extensionsTypes.AutocompleteProviderFactory[] = [];

  fdPath!: string | undefined;

  private skillCommands = new Map<string, string>();

  isSkillCommand(text: string): boolean {
    if (!this.mode.settingsManager.resources.getEnableSkillCommands()) return false;
    const name = slashCommandName(text);
    return this.mode.session.resourceLoader.getSkills().skills.some((skill) => skill.name === name);
  }

  private modelArgumentCompletions(prefix: string): tuiTypes.AutocompleteItem[] | null {
    const models =
      this.mode.session.models.selection.scopedModels.length > 0
        ? this.mode.session.models.selection.scopedModels.map((scoped) => scoped.model)
        : this.mode.session.models.selection.modelRuntime.getAvailableSnapshot();
    if (models.length === 0) return null;
    const items = models.map((m) => ({
      id: m.id,
      label: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
    }));
    return createFuzzyAutocompleteItems(items, prefix, getModelSearchText, (item) => ({
      description: item.provider,
      label: item.id,
      value: item.label,
    }));
  }

  private attachArgumentCompletions(
    thinkingCommand: tuiTypes.SlashCommand | undefined,
    slashCommands: tuiTypes.SlashCommand[],
  ): void {
    if (thinkingCommand !== undefined) {
      thinkingCommand.getArgumentCompletions = (
        prefix: string,
      ): tuiTypes.AutocompleteItem[] | null =>
        createFuzzyAutocompleteItems(
          this.mode.session.models.thinking.getAvailableThinkingLevels(),
          prefix,
          (level) => level,
          (level) => ({
            label: level,
            value: level,
          }),
        );
    }

    const loginCommand = slashCommands.find((command) => command.name === "login");
    if (loginCommand !== undefined) {
      loginCommand.getArgumentCompletions = (
        prefix: string,
      ): tuiTypes.AutocompleteItem[] | null => {
        const providers = getLoginProviderCompletionOptions(
          this.mode.models.login.loginFlow.providers.getProviderOptions(),
        );
        const items = [
          ...providers.map((provider) => ({
            item: {
              description: formatLoginProviderCompletionDescription(provider),
              label: provider.id,
              value: provider.id,
            },
            searchText: getLoginProviderSearchText(provider),
          })),
          ...this.mode.session.tools.externalServices.getExternalServices().map((service) => ({
            item: { description: service.purpose, label: service.id, value: service.id },
            searchText: `${service.id} ${service.name} ${service.purpose}`,
          })),
        ];
        return createFuzzyAutocompleteItems(
          items,
          prefix,
          (entry) => entry.searchText,
          (entry) => entry.item,
        );
      };
    }
  }

  createBaseAutocompleteProvider(): tuiTypes.AutocompleteProvider {
    const { thinkingCommand, slashCommands } = this.builtinSlashCommands();
    this.attachArgumentCompletions(thinkingCommand, slashCommands);
    return new CombinedAutocompleteProvider(
      withSkillCommands(
        [...slashCommands, ...this.templateCommands(), ...this.extensionCommands()],
        this.skillCommandList(),
      ),
      this.mode.sessionManager.getCwd(),
      this.fdPath,
    );
  }

  private templateCommands(): tuiTypes.SlashCommand[] {
    const labels = this.mode.input.autocompleteLabels;
    return this.mode.session.promptTemplates.map((cmd) => ({
      name: cmd.name,
      ...labels.autocompleteDescription(cmd.description, cmd.sourceInfo),
      ...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
    }));
  }

  private extensionCommands(): tuiTypes.SlashCommand[] {
    const labels = this.mode.input.autocompleteLabels;
    return this.mode.session.extensions.binding.extensionRunner
      .getRegisteredCommands()
      .filter((cmd) => !isBuiltinSlashCommandName(cmd.name))
      .map((cmd) => {
        const slashCommand: tuiTypes.SlashCommand = { name: cmd.invocationName };
        Object.assign(
          slashCommand,
          labels.autocompleteDescription(cmd.description, cmd.sourceInfo),
        );
        if (cmd.getArgumentCompletions !== undefined) {
          slashCommand.getArgumentCompletions = cmd.getArgumentCompletions;
        }
        return slashCommand;
      });
  }

  private skillCommandList(): tuiTypes.SlashCommand[] {
    this.skillCommands.clear();
    if (!this.mode.settingsManager.resources.getEnableSkillCommands()) return [];
    const labels = this.mode.input.autocompleteLabels;
    const commands: tuiTypes.SlashCommand[] = [];
    for (const skill of this.mode.session.resourceLoader.getSkills().skills) {
      this.skillCommands.set(skill.name, skill.filePath);
      commands.push({
        name: skill.name,
        ...labels.autocompleteDescription(skill.description, skill.sourceInfo),
      });
    }
    return commands;
  }

  private builtinSlashCommands(): {
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

  setupAutocompleteProvider(): void {
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
    this.mode.defaultEditor.setAutocompleteProvider(provider);
    if (this.mode.editor !== this.mode.defaultEditor) {
      this.mode.editor.setAutocompleteProvider?.(provider);
    }
  }

  refreshProvidersAfterAccounts(): Promise<void> {
    return this.mode.session.models.selection.modelRuntime
      .refresh({ allowNetwork: false })
      .then(() => this.setupAutocompleteProvider());
  }
}
