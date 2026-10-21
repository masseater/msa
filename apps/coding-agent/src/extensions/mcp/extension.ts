import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type extensionTypes from "./extension.types.ts";
import McpExtensionHost from "./extension/host.ts";
import serversSection from "./extension/servers-section.ts";

const { MAX_SERVERS_SECTION_CHARS, MCP_SERVERS_SECTION, renderServersSection } = serversSection;

function createMcpExtension(
  options: extensionTypes.McpExtensionOptions = {},
): extensionsTypesTypes.ExtensionFactory {
  return (msa: extensionsTypesTypes.ExtensionAPI) => {
    new McpExtensionHost(msa, options).register();
  };
}

const extension = {
  MAX_SERVERS_SECTION_CHARS,
  MCP_SERVERS_SECTION,
  createMcpExtension,
  renderServersSection,
};

export default extension;
