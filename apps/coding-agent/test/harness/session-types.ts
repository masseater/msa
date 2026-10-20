import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type agentSessionTypes from "../../src/core/agent-session.types.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import type settingsManagerTypes from "../../src/core/settings-manager.types.ts";
import type srcTypes from "../../src/index.types.ts";
import type utilitiesTypes from "../utilities.types.ts";
import type fauxModelTypes from "./faux-model.types.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";

declare namespace sessionTypesModule {
  interface HarnessOptions {
    responses?: fauxModelTypes.FauxResponseInput[];
    model?: aiTypes.Model<any>;
    contextWindow?: number;
    settings?: Partial<settingsManagerTypes.Settings>;
    systemPrompt?: string;
    tools?: agentTypes.AgentTool[];
    baseToolsOverride?: Record<string, agentTypes.AgentTool>;
    resourceLoader?: srcTypes.ResourceLoader;
    extensionFactories?: Array<
      srcTypes.InlineExtension | utilitiesTypes.CreateTestExtensionsResultInput
    >;
  }

  interface Harness {
    session: agentSessionTypes.AgentSession;
    agent: agentTypes.Agent;
    sessionManager: sessionManagerTypes.SessionManager;
    settingsManager: settingsManagerTypes.SettingsManager;
    faux: fauxStreamTypes.FauxStreamFnState;
    events: agentSessionTypes.AgentSessionEvent[];
    eventsOfType<T extends agentSessionTypes.AgentSessionEvent["type"]>(
      type: T,
    ): Extract<agentSessionTypes.AgentSessionEvent, { type: T }>[];
    tempDir: string;
    cleanup: () => void;
  }
}

export type { sessionTypesModule as default };
