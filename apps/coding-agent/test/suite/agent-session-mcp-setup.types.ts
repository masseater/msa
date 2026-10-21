import type extensionsTypesTypes from "../../src/core/extensions/types.types.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import type configTypes from "../../src/extensions/mcp/config.types.ts";

declare namespace agentSessionMcpSetupTypes {
  interface SetupOptions {
    autoEnableCodemode?: boolean;
    builtInTools?: string[];
    allowedToolNames?: string[];
    excludedToolNames?: string[];
    sessionManager?: sessionManagerTypes.SessionManager;
    waitForTools?: boolean;
    extensionFactories?: extensionsTypesTypes.ExtensionFactory[];
    toolExposure?: Record<string, configTypes.McpExposure>;
    resources?: boolean;
    withoutToolSearch?: boolean;
    description?: string;
    instructions?: string;
  }

  interface SlowConfig {
    exposure?: configTypes.McpExposure;
    toolExposure?: Record<string, configTypes.McpExposure>;
    name?: string;
    instructions?: string;
  }
}

export type { agentSessionMcpSetupTypes as default };
