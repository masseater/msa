import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type { AgentSession, AgentSessionEvent } from "../../../src/core/agent-session.ts";
import type { AuthStorage } from "../../../src/core/auth-storage.ts";
import type { SessionTelemetryOptions } from "../../../src/core/observability/session-telemetry.ts";
import type { SessionManager } from "../../../src/core/session-manager.ts";
import type { Settings, SettingsManager } from "../../../src/core/settings-manager.ts";
import type { InlineExtension, ResourceLoader } from "../../../src/index.ts";
import type utilitiesTypes from "../../utilities.types.ts";

declare namespace typesModule {
  interface HarnessOptions {
    models?: compatTypes.FauxModelDefinition[];
    settings?: Partial<Settings>;
    tools?: agentTypes.AgentTool[];
    initialActiveToolNames?: string[];
    allowedToolNames?: string[] | undefined;
    excludedToolNames?: string[] | undefined;
    resourceLoader?: ResourceLoader;
    extensionFactories?:
      | Array<InlineExtension | utilitiesTypes.CreateTestExtensionsResultInput>
      | undefined;
    withConfiguredAuth?: boolean;
    modelsJson?: Record<string, unknown>;

    sessionManager?: SessionManager | undefined;
    telemetry?: SessionTelemetryOptions | undefined;
  }

  interface Harness {
    session: AgentSession;
    sessionManager: SessionManager;
    settingsManager: SettingsManager;
    authStorage: AuthStorage;
    faux: compatTypes.FauxProviderRegistration;
    models: [compatTypes.Model<string>, ...compatTypes.Model<string>[]];
    getModel(): compatTypes.Model<string>;
    getModel(modelId: string): compatTypes.Model<string> | undefined;
    setResponses: (responses: compatTypes.FauxResponseStep[]) => void;
    appendResponses: (responses: compatTypes.FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;
    events: AgentSessionEvent[];
    eventsOfType<T extends AgentSessionEvent["type"]>(
      type: T,
    ): Extract<AgentSessionEvent, { type: T }>[];
    tempDir: string;
    cleanup: () => void;
  }
}

export type { typesModule as default };
