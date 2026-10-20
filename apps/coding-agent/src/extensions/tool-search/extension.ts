import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import tool from "./tool.ts";

const { createToolSearchToolDefinition } = tool;

function createToolSearchExtension(): extensionsTypesTypes.ExtensionFactory {
  return (msa) => {
    msa.registerTool({ ...createToolSearchToolDefinition({ tools: msa }), defaultActive: false });
  };
}

const extension = {
  createToolSearchExtension,
};

export default extension;
