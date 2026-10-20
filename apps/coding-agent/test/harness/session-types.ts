import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type { AgentSession, AgentSessionEvent } from "../../src/core/agent-session.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import type { Settings, SettingsManager } from "../../src/core/settings-manager.ts";
import type { InlineExtension, ResourceLoader } from "../../src/index.ts";
import type utilitiesTypes from "../utilities.types.ts";
import type fauxModelTypes from "./faux-model.types.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";

declare namespace sessionTypesModule {
  interface HarnessOptions {
    responses?: fauxModelTypes.FauxResponseInput[];
    model?: aiTypes.Model<any>;
    contextWindow?: number;
    settings?: Partial<Settings>;
    systemPrompt?: string;
    tools?: agentTypes.AgentTool[];
    baseToolsOverride?: Record<string, agentTypes.AgentTool>;
    resourceLoader?: ResourceLoader;
    extensionFactories?: Array<InlineExtension | utilitiesTypes.CreateTestExtensionsResultInput>;
  }

  interface Harness {
    session: AgentSession;
    agent: agentTypes.Agent;
    sessionManager: SessionManager;
    settingsManager: SettingsManager;
    faux: fauxStreamTypes.FauxStreamFnState;
    events: AgentSessionEvent[];
    eventsOfType<T extends AgentSessionEvent["type"]>(
      type: T,
    ): Extract<AgentSessionEvent, { type: T }>[];
    tempDir: string;
    cleanup: () => void;
  }
}

export type { sessionTypesModule as default };
