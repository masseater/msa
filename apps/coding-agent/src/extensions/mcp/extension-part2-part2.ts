import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type extensionTypes from "./extension.types.ts";
import McpExtensionHost from "./extension/host.ts";

function createMcpExtension(
  options: extensionTypes.McpExtensionOptions = {},
): extensionsTypesTypes.ExtensionFactory {
  return (msa: extensionsTypesTypes.ExtensionAPI) => {
    new McpExtensionHost(msa, options).register();
  };
}

const extensionPart2Part2 = {
  createMcpExtension,
};

export default extensionPart2Part2;
