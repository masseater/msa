import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionTypes from "../../../src/core/agent-session.types.ts";
import type authStorageTypes from "../../../src/core/auth-storage.types.ts";
import type sessionTelemetryTypes from "../../../src/core/observability/session-telemetry.types.ts";
import type sessionManagerTypes from "../../../src/core/session-manager.types.ts";
import type settingsManagerTypes from "../../../src/core/settings-manager.types.ts";
import type srcTypes from "../../../src/index.types.ts";
import type utilitiesTypes from "../../utilities.types.ts";

declare namespace typesModule {
  interface HarnessOptions {
    tempDir?: string;
    models?: compatTypes.FauxModelDefinition[];
    settings?: Partial<settingsManagerTypes.Settings>;
    tools?: agentTypes.AgentTool[];
    initialActiveToolNames?: string[];
    allowedToolNames?: string[] | undefined;
    excludedToolNames?: string[] | undefined;
    resourceLoader?: srcTypes.ResourceLoader;
    extensionFactories?:
      | Array<srcTypes.InlineExtension | utilitiesTypes.CreateTestExtensionsResultInput>
      | undefined;
    withConfiguredAuth?: boolean;
    modelsJson?: Record<string, unknown>;

    sessionManager?: sessionManagerTypes.SessionManager | undefined;
    telemetry?: sessionTelemetryTypes.SessionTelemetryOptions | undefined;
    memoryConnection?: agentSessionTypes.AgentSessionConfig["memoryConnection"];
  }

  interface Harness {
    session: agentSessionTypes.AgentSession;
    sessionManager: sessionManagerTypes.SessionManager;
    settingsManager: settingsManagerTypes.SettingsManager;
    authStorage: authStorageTypes.AuthStorage;
    faux: compatTypes.FauxProviderRegistration;
    models: [compatTypes.Model<string>, ...compatTypes.Model<string>[]];
    getModel(): compatTypes.Model<string>;
    getModel(modelId: string): compatTypes.Model<string> | undefined;
    setResponses: (responses: compatTypes.FauxResponseStep[]) => void;
    appendResponses: (responses: compatTypes.FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;
    events: agentSessionTypes.AgentSessionEvent[];
    eventsOfType<T extends agentSessionTypes.AgentSessionEvent["type"]>(
      type: T,
    ): Extract<agentSessionTypes.AgentSessionEvent, { type: T }>[];
    tempDir: string;
    cleanup: () => Promise<void>;
  }
}

export type { typesModule as default };
