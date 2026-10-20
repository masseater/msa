import define from "../harness/define.ts";
import bash from "./bash.ts";
import editModule from "./edit.ts";
import image from "./image.ts";
import read from "./read.ts";
import type readTypes from "./read.types.ts";
import writeModule from "./write.ts";

const { defineExtension } = define;
const { createReadTool } = read;
const { createWriteTool } = writeModule;
const { createEditTool } = editModule;
const { createBashTool } = bash;

function createCodingTools(options: readTypes.ReadToolOptions = {}) {
  return defineExtension({
    name: "coding-tools",
    tools: [createReadTool(options), createWriteTool(), createEditTool(), createBashTool()],
  });
}

const CodingTools = createCodingTools();

const toolsModule = {
  CodingTools,
  DEFAULT_IMAGE_LIMITS: image.DEFAULT_IMAGE_LIMITS,
  createBashTool: bash.createBashTool,
  createCodingTools,
  createEditTool: editModule.createEditTool,
  createPowerShellTool: bash.createPowerShellTool,
  createReadTool: read.createReadTool,
  createWriteTool: writeModule.createWriteTool,
};

export default toolsModule;
