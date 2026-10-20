import agentSessionMcpHarness from "./agent-session-mcp-harness.ts";
import agentSessionMcpInspect from "./agent-session-mcp-inspect.ts";
import agentSessionMcpReload from "./agent-session-mcp-reload.ts";
import agentSessionMcpSetup from "./agent-session-mcp-setup.ts";
import mcpFakeServer from "./mcp-fake-server.ts";

const agentSessionMcpSupport = {
  ...agentSessionMcpInspect,
  ...agentSessionMcpReload,
  ...agentSessionMcpSetup,
  ...mcpFakeServer,
  harnesses: agentSessionMcpHarness.harnesses,
};

export default agentSessionMcpSupport;
