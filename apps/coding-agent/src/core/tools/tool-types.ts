import type { AgentTool } from "@msa/agent-core";

import type { ToolDefinition } from "../extensions/types.ts";
import type { BashToolOptions } from "./bash.ts";
import type { EditToolOptions } from "./edit.ts";
import type { FindToolOptions } from "./find.ts";
import type { GrepToolOptions } from "./grep.ts";
import type { LsToolOptions } from "./ls.ts";
import type { PowerShellToolOptions } from "./powershell.ts";
import type { ReadToolOptions } from "./read.ts";
import type { WriteToolOptions } from "./write.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";
export const allToolNames: Set<ToolName> = new Set([
  "read",
  "bash",
  "powershell",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

export interface ToolsOptions {
  read?: ReadToolOptions;
  bash?: BashToolOptions;
  powershell?: PowerShellToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
  grep?: GrepToolOptions;
  find?: FindToolOptions;
  ls?: LsToolOptions;
}
