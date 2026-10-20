import type toolTypesTypes from "./tool-types.types.ts";

const allToolNames: Set<toolTypesTypes.ToolName> = new Set([
  "read",
  "bash",
  "powershell",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

const toolTypes = {
  allToolNames,
};

export default toolTypes;
