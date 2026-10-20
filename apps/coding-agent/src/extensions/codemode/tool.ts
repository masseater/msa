import toolPart1 from "./tool-part1.ts";
import toolPart2 from "./tool-part2.ts";
import toolPart4 from "./tool-part4.ts";
import toolPart5 from "./tool-part5.ts";

const {
  CODEMODE_DOCS_PATH,
  CODEMODE_STORE_ENTRY_TYPE,
  CODEMODE_TOOL_NAME,
  DEFAULT_CODEMODE_INLINE_BUDGET,
  codemodeSchema,
  codemodeToolSystemPromptContribution,
  getCodemodeCallableTools,
  toCodemodeDeclaration,
} = toolPart1;
const { createCodemodeDescription } = toolPart2;
const { createCodemodeTool } = toolPart5;
const { createCodemodeToolDefinition } = toolPart4;

const tool = {
  CODEMODE_DOCS_PATH,
  CODEMODE_STORE_ENTRY_TYPE,
  CODEMODE_TOOL_NAME,
  DEFAULT_CODEMODE_INLINE_BUDGET,
  codemodeSchema,
  codemodeToolSystemPromptContribution,
  createCodemodeDescription,
  createCodemodeTool,
  createCodemodeToolDefinition,
  getCodemodeCallableTools,
  toCodemodeDeclaration,
};

export default tool;
