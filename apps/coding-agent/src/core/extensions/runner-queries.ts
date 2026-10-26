import type tuiTypes from "@msa/tui/index.types";
import { Console, Effect } from "effect";

import type diagnosticsTypes from "../diagnostics.ts";
import type externalServicesTypes from "../external-services.types.ts";
import type keybindingsTypes from "../keybindings.types.ts";
import type modelRegistryTypes from "../model-registry.types.ts";
import runnerKeybindings from "./runner-keybindings.ts";
import type runnerQueriesTypes from "./runner-queries.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { buildBuiltinKeybindings } = runnerKeybindings;

const withInvocationName = (
  command: extensionsTypesTypes.RegisteredCommand,
  invocationName: string,
): extensionsTypesTypes.ResolvedCommand => ({ ...command, invocationName });

export default class RunnerQueries {
  private readonly extensions: extensionsTypesTypes.Extension[];
  private readonly runtime: extensionsTypesTypes.ExtensionRuntime;
  private readonly modelRegistry: modelRegistryTypes.ModelRegistry;
  private readonly hasUI: () => boolean;
  private shortcutDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  private commandDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  constructor(source: runnerQueriesTypes.QuerySource) {
    this.extensions = source.extensions;
    this.runtime = source.runtime;
    this.modelRegistry = source.modelRegistry;
    this.hasUI = source.hasUI;
  }

  getExtensionPaths(): string[] {
    return this.extensions.map((e) => e.path);
  }

  getAllRegisteredTools(): extensionsTypesTypes.RegisteredTool[] {
    const toolsByName = new Map<string, extensionsTypesTypes.RegisteredTool>();
    for (const ext of this.extensions) {
      for (const tool of ext.tools.values()) {
        if (!toolsByName.has(tool.definition.name)) {
          toolsByName.set(tool.definition.name, tool);
        }
      }
    }
    return Array.from(toolsByName.values());
  }

  getToolDefinition(
    toolName: string,
  ): extensionsTypesTypes.RegisteredTool["definition"] | undefined {
    for (const ext of this.extensions) {
      const tool = ext.tools.get(toolName);
      if (tool !== undefined) {
        return tool.definition;
      }
    }
    return undefined;
  }

  getFlags(): Map<string, extensionsTypesTypes.ExtensionFlag> {
    const allFlags = new Map<string, extensionsTypesTypes.ExtensionFlag>();
    for (const ext of this.extensions) {
      for (const [name, flag] of ext.flags) {
        if (!allFlags.has(name)) {
          allFlags.set(name, flag);
        }
      }
    }
    return allFlags;
  }

  setFlagValue(name: string, value: boolean | string): void {
    this.runtime.flagValues.set(name, value);
  }

  getFlagValues(): Map<string, boolean | string> {
    return new Map(this.runtime.flagValues);
  }

  getShortcuts(
    resolvedKeybindings: keybindingsTypes.KeybindingsConfig,
  ): Map<tuiTypes.KeyId, extensionsTypesTypes.ExtensionShortcut> {
    this.shortcutDiagnostics = [];
    const builtinKeybindings = buildBuiltinKeybindings(resolvedKeybindings);
    const extensionShortcuts = new Map<tuiTypes.KeyId, extensionsTypesTypes.ExtensionShortcut>();

    const addDiagnostic = (message: string, extensionPath: string) => {
      this.shortcutDiagnostics.push({ message, path: extensionPath, type: "warning" });
      if (!this.hasUI()) {
        Effect.runSync(Console.warn(message));
      }
    };

    for (const ext of this.extensions) {
      for (const [key, shortcut] of ext.shortcuts) {
        const normalizedKey = key.toLowerCase() as tuiTypes.KeyId;

        const builtInKeybinding = builtinKeybindings[normalizedKey];
        if (builtInKeybinding?.restrictOverride === true) {
          addDiagnostic(
            `Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.`,
            shortcut.extensionPath,
          );
          continue;
        }

        if (builtInKeybinding?.restrictOverride === false) {
          addDiagnostic(
            `Extension shortcut conflict: '${key}' is built-in shortcut for ${builtInKeybinding.keybinding} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
            shortcut.extensionPath,
          );
        }

        const existingExtensionShortcut = extensionShortcuts.get(normalizedKey);
        if (existingExtensionShortcut !== undefined) {
          addDiagnostic(
            `Extension shortcut conflict: '${key}' registered by both ${existingExtensionShortcut.extensionPath} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
            shortcut.extensionPath,
          );
        }
        extensionShortcuts.set(normalizedKey, shortcut);
      }
    }
    return extensionShortcuts;
  }

  getShortcutDiagnostics(): diagnosticsTypes.ResourceDiagnostic[] {
    return this.shortcutDiagnostics;
  }

  hasHandlers(eventType: string): boolean {
    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(eventType);
      if (handlers !== undefined && handlers.length > 0) {
        return true;
      }
    }
    return false;
  }

  getMessageRenderer(customType: string): extensionsTypesTypes.MessageRenderer | undefined {
    for (const ext of this.extensions) {
      const renderer = ext.messageRenderers.get(customType);
      if (renderer !== undefined) {
        return renderer;
      }
    }
    return undefined;
  }

  getExternalServices(): externalServicesTypes.ExternalService[] {
    return this.extensions.flatMap((ext) => ext.externalServices ?? []);
  }

  getMarkdownTransformers(): extensionsTypesTypes.MarkdownTransformer[] {
    return this.extensions.flatMap((ext) =>
      ext.markdownTransformer === undefined ? [] : [ext.markdownTransformer],
    );
  }

  resolveToolRenderers(
    toolName: string,
    base: () => extensionsTypesTypes.ToolRenderers | undefined,
  ): extensionsTypesTypes.ToolRenderers | undefined {
    const resolvers = this.extensions.flatMap((ext) => ext.toolRenderers ?? []);
    const resolve = (index: number): extensionsTypesTypes.ToolRenderers | undefined => {
      const resolver = resolvers[index];
      return resolver === undefined ? base() : resolver(toolName, () => resolve(index + 1));
    };
    return resolve(0);
  }

  getEntryRenderer(customType: string): extensionsTypesTypes.EntryRenderer | undefined {
    for (const ext of this.extensions) {
      const renderer = ext.entryRenderers?.get(customType);
      if (renderer !== undefined) {
        return renderer;
      }
    }
    return undefined;
  }

  getModelRegistry(): modelRegistryTypes.ModelRegistry {
    return this.modelRegistry;
  }

  getRegisteredCommands(): extensionsTypesTypes.ResolvedCommand[] {
    this.commandDiagnostics = [];
    return this.resolveRegisteredCommands();
  }

  getCommandDiagnostics(): diagnosticsTypes.ResourceDiagnostic[] {
    return this.commandDiagnostics;
  }

  getCommand(name: string): extensionsTypesTypes.ResolvedCommand | undefined {
    return this.resolveRegisteredCommands().find((command) => command.invocationName === name);
  }

  private resolveRegisteredCommands(): extensionsTypesTypes.ResolvedCommand[] {
    const commands: extensionsTypesTypes.RegisteredCommand[] = [];
    const counts = new Map<string, number>();

    for (const ext of this.extensions) {
      for (const command of ext.commands.values()) {
        commands.push(command);
        counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
      }
    }

    const seen = new Map<string, number>();
    const takenInvocationNames = new Set<string>();

    return commands.map((command) => {
      const occurrence = (seen.get(command.name) ?? 0) + 1;
      seen.set(command.name, occurrence);

      let invocationName =
        (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;

      if (takenInvocationNames.has(invocationName)) {
        let suffix = occurrence;
        do {
          suffix++;
          invocationName = `${command.name}:${suffix}`;
        } while (takenInvocationNames.has(invocationName));
      }

      takenInvocationNames.add(invocationName);
      return withInvocationName(command, invocationName);
    });
  }
}
