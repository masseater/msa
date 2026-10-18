import type { KeyId } from "@msa/tui";
import { Console } from "effect";

import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { ExternalService } from "../external-services.ts";
import type { KeybindingsConfig } from "../keybindings.ts";
import type { ModelRegistry } from "../model-registry.ts";
import { platformRuntime } from "../platform/index.ts";
import type { SessionManager } from "../session-manager.ts";
import { buildBuiltinKeybindings } from "./runner-keybindings.ts";
import type {
  EntryRenderer,
  Extension,
  ExtensionFlag,
  ExtensionRuntime,
  ExtensionShortcut,
  MarkdownTransformer,
  MessageRenderer,
  RegisteredCommand,
  RegisteredTool,
  ResolvedCommand,
  ToolRenderers,
} from "./types.ts";

export abstract class RunnerQueries {
  protected extensions: Extension[];
  protected runtime: ExtensionRuntime;
  protected cwd: string;
  protected sessionManager: SessionManager;
  protected modelRegistry: ModelRegistry;
  private shortcutDiagnostics: ResourceDiagnostic[] = [];
  private commandDiagnostics: ResourceDiagnostic[] = [];

  constructor(
    extensions: Extension[],
    runtime: ExtensionRuntime,
    cwd: string,
    sessionManager: SessionManager,
    modelRegistry: ModelRegistry,
  ) {
    this.extensions = extensions;
    this.runtime = runtime;
    this.cwd = cwd;
    this.sessionManager = sessionManager;
    this.modelRegistry = modelRegistry;
  }

  abstract hasUI(): boolean;

  getExtensionPaths(): string[] {
    return this.extensions.map((e) => e.path);
  }

  getAllRegisteredTools(): RegisteredTool[] {
    const toolsByName = new Map<string, RegisteredTool>();
    for (const ext of this.extensions) {
      for (const tool of ext.tools.values()) {
        if (!toolsByName.has(tool.definition.name)) {
          toolsByName.set(tool.definition.name, tool);
        }
      }
    }
    return Array.from(toolsByName.values());
  }

  getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
    for (const ext of this.extensions) {
      const tool = ext.tools.get(toolName);
      if (tool !== undefined) {
        return tool.definition;
      }
    }
    return undefined;
  }

  getFlags(): Map<string, ExtensionFlag> {
    const allFlags = new Map<string, ExtensionFlag>();
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

  getShortcuts(resolvedKeybindings: KeybindingsConfig): Map<KeyId, ExtensionShortcut> {
    this.shortcutDiagnostics = [];
    const builtinKeybindings = buildBuiltinKeybindings(resolvedKeybindings);
    const extensionShortcuts = new Map<KeyId, ExtensionShortcut>();

    const addDiagnostic = (message: string, extensionPath: string) => {
      this.shortcutDiagnostics.push({ type: "warning", message, path: extensionPath });
      if (!this.hasUI()) {
        platformRuntime.runSync(Console.warn(message));
      }
    };

    for (const ext of this.extensions) {
      for (const [key, shortcut] of ext.shortcuts) {
        const normalizedKey = key.toLowerCase() as KeyId;

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

  getShortcutDiagnostics(): ResourceDiagnostic[] {
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

  getMessageRenderer(customType: string): MessageRenderer | undefined {
    for (const ext of this.extensions) {
      const renderer = ext.messageRenderers.get(customType);
      if (renderer !== undefined) {
        return renderer;
      }
    }
    return undefined;
  }

  getExternalServices(): ExternalService[] {
    return this.extensions.flatMap((ext) => ext.externalServices ?? []);
  }

  getMarkdownTransformers(): MarkdownTransformer[] {
    return this.extensions.flatMap((ext) =>
      ext.markdownTransformer === undefined ? [] : [ext.markdownTransformer],
    );
  }

  resolveToolRenderers(
    toolName: string,
    base: () => ToolRenderers | undefined,
  ): ToolRenderers | undefined {
    const resolvers = this.extensions.flatMap((ext) => ext.toolRenderers ?? []);
    const resolve = (index: number): ToolRenderers | undefined => {
      const resolver = resolvers[index];
      return resolver === undefined ? base() : resolver(toolName, () => resolve(index + 1));
    };
    return resolve(0);
  }

  getEntryRenderer(customType: string): EntryRenderer | undefined {
    for (const ext of this.extensions) {
      const renderer = ext.entryRenderers?.get(customType);
      if (renderer !== undefined) {
        return renderer;
      }
    }
    return undefined;
  }

  getModelRegistry(): ModelRegistry {
    return this.modelRegistry;
  }

  getRegisteredCommands(): ResolvedCommand[] {
    this.commandDiagnostics = [];
    return this.resolveRegisteredCommands();
  }

  getCommandDiagnostics(): ResourceDiagnostic[] {
    return this.commandDiagnostics;
  }

  getCommand(name: string): ResolvedCommand | undefined {
    return this.resolveRegisteredCommands().find((command) => command.invocationName === name);
  }

  private resolveRegisteredCommands(): ResolvedCommand[] {
    const commands: RegisteredCommand[] = [];
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
      return Object.assign({}, command, { invocationName });
    });
  }
}
