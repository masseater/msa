import type { ExtensionFactory } from "../../src/core/extensions/types.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import type { McpExposure } from "../../src/extensions/mcp/config.ts";

declare namespace agentSessionMcpSetupTypes {
  interface SetupOptions {
    autoEnableCodemode?: boolean;
    builtInTools?: string[];
    allowedToolNames?: string[];
    excludedToolNames?: string[];
    sessionManager?: SessionManager;
    waitForTools?: boolean;
    extensionFactories?: ExtensionFactory[];
    toolExposure?: Record<string, McpExposure>;
    resources?: boolean;
    withoutToolSearch?: boolean;
    description?: string;
    instructions?: string;
  }

  interface SlowConfig {
    exposure?: McpExposure;
    toolExposure?: Record<string, McpExposure>;
    name?: string;
    instructions?: string;
  }
}

export type { agentSessionMcpSetupTypes as default };
