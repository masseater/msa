import type editDiffTypes from "../core/tools/edit-diff.types.ts";
import type toolsTypes from "../core/tools/index.types.ts";
import type imageResizeTypes from "../utils/image-resize.types.ts";

declare namespace codingAgentToolsKitTypes {
  type EditDiffResult = editDiffTypes.EditDiffResult;
  type BashOperations = toolsTypes.BashOperations;
  type BashSpawnContext = toolsTypes.BashSpawnContext;
  type BashSpawnHook = toolsTypes.BashSpawnHook;
  type BashToolDetails = toolsTypes.BashToolDetails;
  type BashToolInput = toolsTypes.BashToolInput;
  type BashToolOptions = toolsTypes.BashToolOptions;
  type EditOperations = toolsTypes.EditOperations;
  type EditToolDetails = toolsTypes.EditToolDetails;
  type EditToolInput = toolsTypes.EditToolInput;
  type EditToolOptions = toolsTypes.EditToolOptions;
  type FindOperations = toolsTypes.FindOperations;
  type FindToolDetails = toolsTypes.FindToolDetails;
  type FindToolInput = toolsTypes.FindToolInput;
  type FindToolOptions = toolsTypes.FindToolOptions;
  type GrepOperations = toolsTypes.GrepOperations;
  type GrepToolDetails = toolsTypes.GrepToolDetails;
  type GrepToolInput = toolsTypes.GrepToolInput;
  type GrepToolOptions = toolsTypes.GrepToolOptions;
  type LsOperations = toolsTypes.LsOperations;
  type LsToolDetails = toolsTypes.LsToolDetails;
  type LsToolInput = toolsTypes.LsToolInput;
  type LsToolOptions = toolsTypes.LsToolOptions;
  type PowerShellOperations = toolsTypes.PowerShellOperations;
  type PowerShellSpawnContext = toolsTypes.PowerShellSpawnContext;
  type PowerShellSpawnHook = toolsTypes.PowerShellSpawnHook;
  type PowerShellToolDetails = toolsTypes.PowerShellToolDetails;
  type PowerShellToolInput = toolsTypes.PowerShellToolInput;
  type PowerShellToolOptions = toolsTypes.PowerShellToolOptions;
  type ReadOperations = toolsTypes.ReadOperations;
  type ReadToolDetails = toolsTypes.ReadToolDetails;
  type ReadToolInput = toolsTypes.ReadToolInput;
  type ReadToolOptions = toolsTypes.ReadToolOptions;
  type ToolsOptions = toolsTypes.ToolsOptions;
  type TruncationOptions = toolsTypes.TruncationOptions;
  type TruncationResult = toolsTypes.TruncationResult;
  type WriteOperations = toolsTypes.WriteOperations;
  type WriteToolInput = toolsTypes.WriteToolInput;
  type WriteToolOptions = toolsTypes.WriteToolOptions;
  type ResizedImage = imageResizeTypes.ResizedImage;
}

export type { codingAgentToolsKitTypes as default };
