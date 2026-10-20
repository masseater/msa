import extensionPart1 from "./extension-part1.ts";
import extensionPart2 from "./extension-part2.ts";

const { MAX_SERVERS_SECTION_CHARS, MCP_SERVERS_SECTION, renderServersSection } = extensionPart1;
const { createMcpExtension } = extensionPart2;

const extension = {
  MAX_SERVERS_SECTION_CHARS,
  MCP_SERVERS_SECTION,
  createMcpExtension,
  renderServersSection,
};

export default extension;
