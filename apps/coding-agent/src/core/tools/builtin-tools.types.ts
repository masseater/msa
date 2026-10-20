import type bashTypes from "./bash.types.ts";
import type editTypes from "./edit.types.ts";
import type findTypes from "./find.types.ts";
import type grepTypes from "./grep.types.ts";
import type lsTypes from "./ls.types.ts";
import type powershellTypes from "./powershell.types.ts";
import type readTypes from "./read.types.ts";
import type writeTypes from "./write.types.ts";

declare namespace builtinToolsTypes {
  type BashOperations = bashTypes.BashOperations;

  type BashSpawnContext = bashTypes.BashSpawnContext;

  type BashSpawnHook = bashTypes.BashSpawnHook;

  type BashToolDetails = bashTypes.BashToolDetails;

  type BashToolInput = bashTypes.BashToolInput;

  type BashToolOptions = bashTypes.BashToolOptions;

  type EditOperations = editTypes.EditOperations;

  type EditToolDetails = editTypes.EditToolDetails;

  type EditToolInput = editTypes.EditToolInput;

  type EditToolOptions = editTypes.EditToolOptions;

  type FindOperations = findTypes.FindOperations;

  type FindToolDetails = findTypes.FindToolDetails;

  type FindToolInput = findTypes.FindToolInput;

  type FindToolOptions = findTypes.FindToolOptions;

  type GrepOperations = grepTypes.GrepOperations;

  type GrepToolDetails = grepTypes.GrepToolDetails;

  type GrepToolInput = grepTypes.GrepToolInput;

  type GrepToolOptions = grepTypes.GrepToolOptions;

  type LsOperations = lsTypes.LsOperations;

  type LsToolDetails = lsTypes.LsToolDetails;

  type LsToolInput = lsTypes.LsToolInput;

  type LsToolOptions = lsTypes.LsToolOptions;

  type PowerShellOperations = powershellTypes.PowerShellOperations;

  type PowerShellSpawnContext = powershellTypes.PowerShellSpawnContext;

  type PowerShellSpawnHook = powershellTypes.PowerShellSpawnHook;

  type PowerShellToolDetails = powershellTypes.PowerShellToolDetails;

  type PowerShellToolInput = powershellTypes.PowerShellToolInput;

  type PowerShellToolOptions = powershellTypes.PowerShellToolOptions;

  type ReadOperations = readTypes.ReadOperations;

  type ReadToolDetails = readTypes.ReadToolDetails;

  type ReadToolInput = readTypes.ReadToolInput;

  type ReadToolOptions = readTypes.ReadToolOptions;

  type WriteOperations = writeTypes.WriteOperations;

  type WriteToolInput = writeTypes.WriteToolInput;

  type WriteToolOptions = writeTypes.WriteToolOptions;
}

export type { builtinToolsTypes as default };
