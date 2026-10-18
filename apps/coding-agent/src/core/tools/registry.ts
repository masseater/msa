import { createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition } from "./edit.ts";
import { createFindTool, createFindToolDefinition } from "./find.ts";
import { createGrepTool, createGrepToolDefinition } from "./grep.ts";
import { createLsTool, createLsToolDefinition } from "./ls.ts";
import { createPowerShellTool, createPowerShellToolDefinition } from "./powershell.ts";
import { createReadTool, createReadToolDefinition } from "./read.ts";
import {
  type CwdFactory,
  cwdFactory,
  type NamedFactory,
  namedFactory,
} from "./tool-definition-wrapper.ts";
import type { Tool, ToolDef, ToolName, ToolsOptions } from "./tool-types.ts";
import { createWriteTool, createWriteToolDefinition } from "./write.ts";

export const createToolDefinition: NamedFactory<ToolName, ToolsOptions, ToolDef> = namedFactory(
  (toolName, cwd, options) => {
    switch (toolName) {
      case "read":
        return createReadToolDefinition(cwd, options?.read);
      case "bash":
        return createBashToolDefinition(cwd, options?.bash);
      case "powershell":
        return createPowerShellToolDefinition(cwd, options?.powershell);
      case "edit":
        return createEditToolDefinition(cwd, options?.edit);
      case "write":
        return createWriteToolDefinition(cwd, options?.write);
      case "grep":
        return createGrepToolDefinition(cwd, options?.grep);
      case "find":
        return createFindToolDefinition(cwd, options?.find);
      case "ls":
        return createLsToolDefinition(cwd, options?.ls);
      default:
        throw new Error(`Unknown tool name: ${toolName}`);
    }
  },
);

export const createTool: NamedFactory<ToolName, ToolsOptions, Tool> = namedFactory(
  (toolName, cwd, options) => {
    switch (toolName) {
      case "read":
        return createReadTool(cwd, options?.read);
      case "bash":
        return createBashTool(cwd, options?.bash);
      case "powershell":
        return createPowerShellTool(cwd, options?.powershell);
      case "edit":
        return createEditTool(cwd, options?.edit);
      case "write":
        return createWriteTool(cwd, options?.write);
      case "grep":
        return createGrepTool(cwd, options?.grep);
      case "find":
        return createFindTool(cwd, options?.find);
      case "ls":
        return createLsTool(cwd, options?.ls);
      default:
        throw new Error(`Unknown tool name: ${toolName}`);
    }
  },
);

export const createCodingToolDefinitions: CwdFactory<ToolsOptions, ToolDef[]> = cwdFactory(
  (cwd, options) => [
    createReadToolDefinition(cwd, options?.read),
    createBashToolDefinition(cwd, options?.bash),
    createEditToolDefinition(cwd, options?.edit),
    createWriteToolDefinition(cwd, options?.write),
  ],
);

export const createReadOnlyToolDefinitions: CwdFactory<ToolsOptions, ToolDef[]> = cwdFactory(
  (cwd, options) => [
    createReadToolDefinition(cwd, options?.read),
    createGrepToolDefinition(cwd, options?.grep),
    createFindToolDefinition(cwd, options?.find),
    createLsToolDefinition(cwd, options?.ls),
  ],
);

export const createAllToolDefinitions: CwdFactory<
  ToolsOptions,
  Record<ToolName, ToolDef>
> = cwdFactory((cwd, options) => ({
  read: createReadToolDefinition(cwd, options?.read),
  bash: createBashToolDefinition(cwd, options?.bash),
  powershell: createPowerShellToolDefinition(cwd, options?.powershell),
  edit: createEditToolDefinition(cwd, options?.edit),
  write: createWriteToolDefinition(cwd, options?.write),
  grep: createGrepToolDefinition(cwd, options?.grep),
  find: createFindToolDefinition(cwd, options?.find),
  ls: createLsToolDefinition(cwd, options?.ls),
}));

export const createCodingTools: CwdFactory<ToolsOptions, Tool[]> = cwdFactory((cwd, options) => [
  createReadTool(cwd, options?.read),
  createBashTool(cwd, options?.bash),
  createEditTool(cwd, options?.edit),
  createWriteTool(cwd, options?.write),
]);

export const createReadOnlyTools: CwdFactory<ToolsOptions, Tool[]> = cwdFactory((cwd, options) => [
  createReadTool(cwd, options?.read),
  createGrepTool(cwd, options?.grep),
  createFindTool(cwd, options?.find),
  createLsTool(cwd, options?.ls),
]);

export const createAllTools: CwdFactory<ToolsOptions, Record<ToolName, Tool>> = cwdFactory(
  (cwd, options) => ({
    read: createReadTool(cwd, options?.read),
    bash: createBashTool(cwd, options?.bash),
    powershell: createPowerShellTool(cwd, options?.powershell),
    edit: createEditTool(cwd, options?.edit),
    write: createWriteTool(cwd, options?.write),
    grep: createGrepTool(cwd, options?.grep),
    find: createFindTool(cwd, options?.find),
    ls: createLsTool(cwd, options?.ls),
  }),
);
