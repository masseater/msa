import type builtinToolsTypes from "./builtin-tools.types.ts";
import type toolTypesTypes from "./tool-types.types.ts";
import type truncateTypes from "./truncate.types.ts";

declare namespace toolsTypes {
  type BashOperations = builtinToolsTypes.BashOperations;

  type BashSpawnContext = builtinToolsTypes.BashSpawnContext;

  type BashSpawnHook = builtinToolsTypes.BashSpawnHook;

  type BashToolDetails = builtinToolsTypes.BashToolDetails;

  type BashToolInput = builtinToolsTypes.BashToolInput;

  type BashToolOptions = builtinToolsTypes.BashToolOptions;

  type EditOperations = builtinToolsTypes.EditOperations;

  type EditToolDetails = builtinToolsTypes.EditToolDetails;

  type EditToolInput = builtinToolsTypes.EditToolInput;

  type EditToolOptions = builtinToolsTypes.EditToolOptions;

  type FindOperations = builtinToolsTypes.FindOperations;

  type FindToolDetails = builtinToolsTypes.FindToolDetails;

  type FindToolInput = builtinToolsTypes.FindToolInput;

  type FindToolOptions = builtinToolsTypes.FindToolOptions;

  type GrepOperations = builtinToolsTypes.GrepOperations;

  type GrepToolDetails = builtinToolsTypes.GrepToolDetails;

  type GrepToolInput = builtinToolsTypes.GrepToolInput;

  type GrepToolOptions = builtinToolsTypes.GrepToolOptions;

  type LsOperations = builtinToolsTypes.LsOperations;

  type LsToolDetails = builtinToolsTypes.LsToolDetails;

  type LsToolInput = builtinToolsTypes.LsToolInput;

  type LsToolOptions = builtinToolsTypes.LsToolOptions;

  type PowerShellOperations = builtinToolsTypes.PowerShellOperations;

  type PowerShellSpawnContext = builtinToolsTypes.PowerShellSpawnContext;

  type PowerShellSpawnHook = builtinToolsTypes.PowerShellSpawnHook;

  type PowerShellToolDetails = builtinToolsTypes.PowerShellToolDetails;

  type PowerShellToolInput = builtinToolsTypes.PowerShellToolInput;

  type PowerShellToolOptions = builtinToolsTypes.PowerShellToolOptions;

  type ReadOperations = builtinToolsTypes.ReadOperations;

  type ReadToolDetails = builtinToolsTypes.ReadToolDetails;

  type ReadToolInput = builtinToolsTypes.ReadToolInput;

  type ReadToolOptions = builtinToolsTypes.ReadToolOptions;

  type WriteOperations = builtinToolsTypes.WriteOperations;

  type WriteToolInput = builtinToolsTypes.WriteToolInput;

  type WriteToolOptions = builtinToolsTypes.WriteToolOptions;

  type Tool = toolTypesTypes.Tool;

  type ToolDef = toolTypesTypes.ToolDef;

  type ToolName = toolTypesTypes.ToolName;

  type ToolsOptions = toolTypesTypes.ToolsOptions;

  type TruncationOptions = truncateTypes.TruncationOptions;

  type TruncationResult = truncateTypes.TruncationResult;
}

export type { toolsTypes as default };
