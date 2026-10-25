import type agentSessionTypes from "../src/core/agent-session.types.ts";
import type extensionsTypes from "../src/core/extensions/index.types.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";

declare namespace utilitiesTypes {
  interface TestSessionOptions {
    inMemory?: boolean;

    systemPrompt?: string;

    settingsOverrides?: Record<string, unknown>;
  }

  interface TestSessionContext {
    session: agentSessionTypes.AgentSession;
    sessionManager: sessionManagerTypes.SessionManager;
    tempDir: string;
    cleanup: () => Promise<void>;
  }

  interface CreateTestExtensionsResultInput {
    factory: extensionsTypes.ExtensionFactory;
    path?: string;
  }

  interface CreateTestResourceLoaderOptions {
    extensions?: extensionsTypes.LoadExtensionsResult["extensions"];
    extensionsResult?: extensionsTypes.LoadExtensionsResult;
  }
}

export type { utilitiesTypes as default };
