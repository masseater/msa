import mcpServers from "../mcp-servers.ts";
import type sdkTypes from "../sdk.types.ts";
import settingsManagerSupport from "../settings-manager-support.ts";
import type SettingsManager from "../settings-manager.ts";

const { createToolNameMatcher } = mcpServers;
const { DEFAULT_TOOL_NAMES, applyToolModifiers, getToolListError, isToolModifier } =
  settingsManagerSupport;

type ToolSelection = {
  toolModifiers: string[] | undefined;
  allowedToolNames: string[] | undefined;
  excludedToolNames: string[] | undefined;
  initialActiveToolNames: string[];
  usesDefaultTools: boolean;
};

const selectTools = (
  options: sdkTypes.CreateAgentSessionOptions,
  settingsManager: SettingsManager,
): ToolSelection => {
  const toolListError = options.tools === undefined ? undefined : getToolListError(options.tools);
  if (toolListError !== undefined && toolListError !== "")
    throw new Error(`Invalid tools option: ${toolListError}`);
  const defaultToolNames =
    options.noTools === undefined
      ? (settingsManager.resources.getDefaultTools() ?? DEFAULT_TOOL_NAMES)
      : [];
  const toolModifiers = options.tools?.some(isToolModifier) === true ? options.tools : undefined;
  const selectedToolNames =
    toolModifiers === undefined
      ? options.tools
      : applyToolModifiers(defaultToolNames, toolModifiers);
  const allowedToolNames =
    toolModifiers === undefined
      ? (options.tools ?? (options.noTools === "all" ? [] : undefined))
      : options.noTools === "all"
        ? selectedToolNames
        : undefined;
  const excludedToolNames = options.excludeTools;
  const isExcludedTool =
    excludedToolNames === undefined ? undefined : createToolNameMatcher(excludedToolNames);
  return {
    allowedToolNames,
    excludedToolNames,
    initialActiveToolNames: (selectedToolNames ?? defaultToolNames).filter(
      (name) => isExcludedTool?.(name) !== true,
    ),
    toolModifiers,
    usesDefaultTools:
      (options.tools === undefined || toolModifiers !== undefined) && options.noTools === undefined,
  };
};

const toolSelection = { selectTools };

export default toolSelection;
