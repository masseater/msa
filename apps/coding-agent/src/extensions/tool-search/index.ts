import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { createToolSearchToolDefinition } from "./tool.ts";

export function createToolSearchExtension(): ExtensionFactory {
  return (msa) => {
    msa.registerTool({ ...createToolSearchToolDefinition({ tools: msa }), defaultActive: false });
  };
}

export default createToolSearchExtension();
