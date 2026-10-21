import type agentTypes from "@msa/agent-core/index.types";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type bashTypes from "./bash.types.ts";
import type editTypes from "./edit.types.ts";
import type findTypes from "./find.types.ts";
import type grepTypes from "./grep.types.ts";
import type lsTypes from "./ls.types.ts";
import type powershellTypes from "./powershell.types.ts";
import type readTypes from "./read.types.ts";
import type writeTypes from "./write.types.ts";

declare namespace toolTypesTypes {
  type Tool = agentTypes.AgentTool<any>;

  type ToolDef = extensionsTypesTypes.ToolDefinition<any, any>;

  type ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";

  interface ToolsOptions {
    read?: readTypes.ReadToolOptions;
    bash?: bashTypes.BashToolOptions;
    powershell?: powershellTypes.PowerShellToolOptions;
    write?: writeTypes.WriteToolOptions;
    edit?: editTypes.EditToolOptions;
    grep?: grepTypes.GrepToolOptions;
    find?: findTypes.FindToolOptions;
    ls?: lsTypes.LsToolOptions;
  }
}

export type { toolTypesTypes as default };
