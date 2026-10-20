import type { AgentSession } from "../src/core/agent-session.ts";
import type { ExtensionFactory, LoadExtensionsResult } from "../src/core/extensions/index.ts";
import type { SessionManager } from "../src/core/session-manager.ts";

declare namespace utilitiesTypes {
  interface TestSessionOptions {
    inMemory?: boolean;

    systemPrompt?: string;

    settingsOverrides?: Record<string, unknown>;
  }

  interface TestSessionContext {
    session: AgentSession;
    sessionManager: SessionManager;
    tempDir: string;
    cleanup: () => void;
  }

  interface CreateTestExtensionsResultInput {
    factory: ExtensionFactory;
    path?: string;
  }

  interface CreateTestResourceLoaderOptions {
    extensions?: LoadExtensionsResult["extensions"];
    extensionsResult?: LoadExtensionsResult;
  }
}

export type { utilitiesTypes as default };
