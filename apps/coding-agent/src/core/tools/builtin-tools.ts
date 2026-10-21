import bash from "./bash.ts";
import edit from "./edit.ts";
import find from "./find.ts";
import grep from "./grep.ts";
import ls from "./ls.ts";
import powershell from "./powershell.ts";
import read from "./read.ts";
import write from "./write.ts";

const builtinTools = {
  createBashTool: bash.createBashTool,
  createBashToolDefinition: bash.createBashToolDefinition,
  createEditTool: edit.createEditTool,
  createEditToolDefinition: edit.createEditToolDefinition,
  createFindTool: find.createFindTool,
  createFindToolDefinition: find.createFindToolDefinition,
  createGrepTool: grep.createGrepTool,
  createGrepToolDefinition: grep.createGrepToolDefinition,
  createLocalBashOperations: bash.createLocalBashOperations,
  createLocalPowerShellOperations: powershell.createLocalPowerShellOperations,
  createLsTool: ls.createLsTool,
  createLsToolDefinition: ls.createLsToolDefinition,
  createPowerShellTool: powershell.createPowerShellTool,
  createPowerShellToolDefinition: powershell.createPowerShellToolDefinition,
  createReadTool: read.createReadTool,
  createReadToolDefinition: read.createReadToolDefinition,
  createWriteTool: write.createWriteTool,
  createWriteToolDefinition: write.createWriteToolDefinition,
};

export default builtinTools;
