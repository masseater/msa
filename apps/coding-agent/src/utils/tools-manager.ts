import toolsManagerPart1 from "./tools-manager-part1.ts";
import toolsManagerPart2 from "./tools-manager-part2.ts";
import toolsManagerPart6 from "./tools-manager-part6.ts";

const { ensureTool } = toolsManagerPart6;
const { getLatestVersion } = toolsManagerPart2;
const { getToolPath } = toolsManagerPart1;

const toolsManager = {
  ensureTool,
  getLatestVersion,
  getToolPath,
};

export default toolsManager;
