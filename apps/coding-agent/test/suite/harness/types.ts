import type { AgentTool } from "@msa/agent-core";
import type {
  FauxModelDefinition,
  FauxProviderRegistration,
  FauxResponseStep,
  Model,
} from "@msa/ai/compat";

import type { AgentSession, AgentSessionEvent } from "../../../src/core/agent-session.ts";
import type { AuthStorage } from "../../../src/core/auth-storage.ts";
import type { SessionTelemetryOptions } from "../../../src/core/observability/session-telemetry.ts";
import type { SessionManager } from "../../../src/core/session-manager.ts";
import type { Settings, SettingsManager } from "../../../src/core/settings-manager.ts";
import type { InlineExtension, ResourceLoader } from "../../../src/index.ts";
import type utilitiesTypes from "../../utilities.types.ts";

declare namespace typesModule {
  interface HarnessOptions {
    models?: FauxModelDefinition[];
    settings?: Partial<Settings>;
    tools?: AgentTool[];
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
    faux: FauxProviderRegistration;
    models: [Model<string>, ...Model<string>[]];
    getModel(): Model<string>;
    getModel(modelId: string): Model<string> | undefined;
    setResponses: (responses: FauxResponseStep[]) => void;
    appendResponses: (responses: FauxResponseStep[]) => void;
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
