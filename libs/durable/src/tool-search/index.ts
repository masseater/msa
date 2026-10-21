import toolSearchModule from "./tool-search.ts";

const toolSearch = {
  DEFAULT_TOOL_SEARCH_LIMIT: toolSearchModule.DEFAULT_TOOL_SEARCH_LIMIT,
  TOOL_SEARCH_TOOL_NAME: toolSearchModule.TOOL_SEARCH_TOOL_NAME,
  createToolSearchExtension: toolSearchModule.createToolSearchExtension,
  createToolSearchTool: toolSearchModule.createToolSearchTool,
};

export default toolSearch;
