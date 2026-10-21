import bashModule from "./bash.ts";
import editModule from "./edit.ts";
import findModule from "./find.ts";
import grepModule from "./grep.ts";
import lsModule from "./ls.ts";
import powershellModule from "./powershell.ts";
import readModule from "./read.ts";
import type registryTypes from "./registry.types.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import writeModule from "./write.ts";

const { cwdFactory, namedFactory } = toolDefinitionWrapper;
const { createReadTool, createReadToolDefinition } = readModule;
const { createBashTool, createBashToolDefinition } = bashModule;
const { createPowerShellTool, createPowerShellToolDefinition } = powershellModule;
const { createEditTool, createEditToolDefinition } = editModule;
const { createWriteTool, createWriteToolDefinition } = writeModule;
const { createGrepTool, createGrepToolDefinition } = grepModule;
const { createFindTool, createFindToolDefinition } = findModule;
const { createLsTool, createLsToolDefinition } = lsModule;

const createToolDefinition: registryTypes.NamedToolFactory<registryTypes.ToolDef> = namedFactory(
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

const createTool: registryTypes.NamedToolFactory<registryTypes.Tool> = namedFactory(
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

const createCodingToolDefinitions: registryTypes.ToolsFactory<registryTypes.ToolDef[]> = cwdFactory(
  (cwd, options) => [
    createReadToolDefinition(cwd, options?.read),
    createBashToolDefinition(cwd, options?.bash),
    createEditToolDefinition(cwd, options?.edit),
    createWriteToolDefinition(cwd, options?.write),
  ],
);

const createReadOnlyToolDefinitions: registryTypes.ToolsFactory<registryTypes.ToolDef[]> =
  cwdFactory((cwd, options) => [
    createReadToolDefinition(cwd, options?.read),
    createGrepToolDefinition(cwd, options?.grep),
    createFindToolDefinition(cwd, options?.find),
    createLsToolDefinition(cwd, options?.ls),
  ]);

const createAllToolDefinitions: registryTypes.ToolsFactory<
  Record<registryTypes.ToolName, registryTypes.ToolDef>
> = cwdFactory((cwd, options) => ({
  bash: createBashToolDefinition(cwd, options?.bash),
  edit: createEditToolDefinition(cwd, options?.edit),
  find: createFindToolDefinition(cwd, options?.find),
  grep: createGrepToolDefinition(cwd, options?.grep),
  ls: createLsToolDefinition(cwd, options?.ls),
  powershell: createPowerShellToolDefinition(cwd, options?.powershell),
  read: createReadToolDefinition(cwd, options?.read),
  write: createWriteToolDefinition(cwd, options?.write),
}));

const createCodingTools: registryTypes.ToolsFactory<registryTypes.Tool[]> = cwdFactory(
  (cwd, options) => [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, options?.bash),
    createEditTool(cwd, options?.edit),
    createWriteTool(cwd, options?.write),
  ],
);

const createReadOnlyTools: registryTypes.ToolsFactory<registryTypes.Tool[]> = cwdFactory(
  (cwd, options) => [
    createReadTool(cwd, options?.read),
    createGrepTool(cwd, options?.grep),
    createFindTool(cwd, options?.find),
    createLsTool(cwd, options?.ls),
  ],
);

const createAllTools: registryTypes.ToolsFactory<
  Record<registryTypes.ToolName, registryTypes.Tool>
> = cwdFactory((cwd, options) => ({
  bash: createBashTool(cwd, options?.bash),
  edit: createEditTool(cwd, options?.edit),
  find: createFindTool(cwd, options?.find),
  grep: createGrepTool(cwd, options?.grep),
  ls: createLsTool(cwd, options?.ls),
  powershell: createPowerShellTool(cwd, options?.powershell),
  read: createReadTool(cwd, options?.read),
  write: createWriteTool(cwd, options?.write),
}));

const registry = {
  createAllToolDefinitions,
  createAllTools,
  createCodingToolDefinitions,
  createCodingTools,
  createReadOnlyToolDefinitions,
  createReadOnlyTools,
  createTool,
  createToolDefinition,
};

export default registry;
