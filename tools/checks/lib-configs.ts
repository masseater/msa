import agentConfig from "../../libs/agent/vite.config.ts";
import chordConfig from "../../libs/chord/vite.config.ts";
import codemodeConfig from "../../libs/codemode/vite.config.ts";
import durableConfig from "../../libs/durable/vite.config.ts";
import envConfig from "../../libs/env/vite.config.ts";
import mcpConfig from "../../libs/mcp/vite.config.ts";
import telemetryConfig from "../../libs/telemetry/vite.config.ts";
import testingConfig from "../../libs/testing/vite.config.ts";
import tuiConfig from "../../libs/tui/vite.config.ts";

const libConfigs = {
  "libs/agent": agentConfig,
  "libs/chord": chordConfig,
  "libs/codemode": codemodeConfig,
  "libs/durable": durableConfig,
  "libs/env": envConfig,
  "libs/mcp": mcpConfig,
  "libs/telemetry": telemetryConfig,
  "libs/testing": testingConfig,
  "libs/tui": tuiConfig,
};

export default libConfigs;
