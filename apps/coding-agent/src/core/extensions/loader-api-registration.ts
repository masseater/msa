import type { KeyId } from "@msa/tui";

import type { ExternalService } from "../external-services.ts";
import type { ApiScope } from "./loader-scope.ts";
import type {
  EntryRenderer,
  ExtensionContext,
  MarkdownTransformer,
  MessageRenderer,
  RegisteredCommand,
  ToolDefinition,
  ToolRendererResolver,
} from "./types.ts";

export const toolAndCommandMembers = ({ extension, runtime, assertActive }: ApiScope) => ({
  registerTool(tool: ToolDefinition): void {
    assertActive();
    if (
      typeof tool.parameters !== "object" ||
      tool.parameters === null ||
      Array.isArray(tool.parameters)
    ) {
      throw new Error(
        `Tool "${tool.name}" registered by extension "${extension.path}" must define an object parameter schema.`,
      );
    }
    extension.tools.set(tool.name, { definition: tool, sourceInfo: extension.sourceInfo });
    runtime.refreshTools();
  },

  registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void {
    assertActive();
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `Command registered by extension "${extension.path}" must have a non-empty string name. Use msa.registerCommand("name", { description, handler }).`,
      );
    }
    if (typeof options?.handler !== "function") {
      throw new Error(
        `Command "/${name}" registered by extension "${extension.path}" must define handler().`,
      );
    }
    extension.commands.set(name, { name, sourceInfo: extension.sourceInfo, ...options });
  },

  registerShortcut(
    shortcut: KeyId,
    options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
  ): void {
    assertActive();
    extension.shortcuts.set(shortcut, { shortcut, extensionPath: extension.path, ...options });
  },
});

export const flagMembers = ({
  extension,
  runtime,
  assertActive,
  isLoading,
  pendingFlagValues,
}: ApiScope) => ({
  registerFlag(
    name: string,
    options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
  ): void {
    assertActive();
    if (options.default !== undefined && typeof options.default !== options.type) {
      throw new Error(
        `Invalid default for flag "${name}": expected ${options.type}, got ${typeof options.default}`,
      );
    }
    extension.flags.set(name, { name, extensionPath: extension.path, ...options });
    if (options.default !== undefined && !runtime.flagValues.has(name)) {
      if (!isLoading()) runtime.flagValues.set(name, options.default);
      else if (!pendingFlagValues.has(name)) pendingFlagValues.set(name, options.default);
    }
  },

  getFlag(name: string): boolean | string | undefined {
    assertActive();
    if (!extension.flags.has(name)) return undefined;
    return runtime.flagValues.has(name)
      ? runtime.flagValues.get(name)
      : pendingFlagValues.get(name);
  },
});

export const rendererMembers = ({ extension, assertActive }: ApiScope) => ({
  registerMessageRenderer<T>(customType: string, renderer: MessageRenderer<T>): void {
    assertActive();
    extension.messageRenderers.set(customType, renderer as MessageRenderer);
  },

  registerMarkdownTransformer(transformer: MarkdownTransformer): void {
    assertActive();
    extension.markdownTransformer = transformer;
  },

  registerExternalService(service: ExternalService): void {
    assertActive();
    extension.externalServices = [...(extension.externalServices ?? []), service];
  },

  registerEntryRenderer<T>(customType: string, renderer: EntryRenderer<T>): void {
    assertActive();
    extension.entryRenderers ??= new Map();
    extension.entryRenderers.set(customType, renderer as EntryRenderer);
  },

  registerToolRenderer(resolver: ToolRendererResolver): void {
    assertActive();
    extension.toolRenderers ??= [];
    extension.toolRenderers.push(resolver);
  },
});
