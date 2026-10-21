import type tuiTypes from "@msa/tui/index.types";

import type externalServicesTypes from "../external-services.types.ts";
import type loaderScopeTypes from "./loader-scope.ts";
import type extensionsTypesTypes from "./types.types.ts";

const toolAndCommandMembers = ({
  extension,
  runtime,
  assertActive,
}: loaderScopeTypes.ApiScope) => ({
  registerCommand(
    name: string,
    options: Omit<extensionsTypesTypes.RegisteredCommand, "name" | "sourceInfo">,
  ): void {
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
    shortcut: tuiTypes.KeyId,
    options: {
      description?: string;
      handler: (ctx: extensionsTypesTypes.ExtensionContext) => Promise<void> | void;
    },
  ): void {
    assertActive();
    extension.shortcuts.set(shortcut, { extensionPath: extension.path, shortcut, ...options });
  },

  registerTool(tool: extensionsTypesTypes.ToolDefinition): void {
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
});

const flagMembers = ({
  extension,
  runtime,
  assertActive,
  isLoading,
  pendingFlagValues,
}: loaderScopeTypes.ApiScope) => ({
  getFlag(name: string): boolean | string | undefined {
    assertActive();
    if (!extension.flags.has(name)) return undefined;
    return runtime.flagValues.has(name)
      ? runtime.flagValues.get(name)
      : pendingFlagValues.get(name);
  },

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
    extension.flags.set(name, { extensionPath: extension.path, name, ...options });
    if (options.default !== undefined && !runtime.flagValues.has(name)) {
      if (!isLoading()) runtime.flagValues.set(name, options.default);
      else if (!pendingFlagValues.has(name)) pendingFlagValues.set(name, options.default);
    }
  },
});

const rendererMembers = ({ extension, assertActive }: loaderScopeTypes.ApiScope) => ({
  registerEntryRenderer<T>(
    customType: string,
    renderer: extensionsTypesTypes.EntryRenderer<T>,
  ): void {
    assertActive();
    extension.entryRenderers ??= new Map();
    extension.entryRenderers.set(customType, renderer as extensionsTypesTypes.EntryRenderer);
  },

  registerExternalService(service: externalServicesTypes.ExternalService): void {
    assertActive();
    extension.externalServices = [...(extension.externalServices ?? []), service];
  },

  registerMarkdownTransformer(transformer: extensionsTypesTypes.MarkdownTransformer): void {
    assertActive();
    extension.markdownTransformer = transformer;
  },

  registerMessageRenderer<T>(
    customType: string,
    renderer: extensionsTypesTypes.MessageRenderer<T>,
  ): void {
    assertActive();
    extension.messageRenderers.set(customType, renderer as extensionsTypesTypes.MessageRenderer);
  },

  registerToolRenderer(resolver: extensionsTypesTypes.ToolRendererResolver): void {
    assertActive();
    extension.toolRenderers ??= [];
    extension.toolRenderers.push(resolver);
  },
});

const loaderApiRegistration = {
  flagMembers,
  rendererMembers,
  toolAndCommandMembers,
};

export default loaderApiRegistration;
