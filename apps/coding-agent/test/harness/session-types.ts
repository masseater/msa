import type { Agent, AgentTool } from "@msa/agent-core";
import type { Model } from "@msa/ai";

import type { AgentSession, AgentSessionEvent } from "../../src/core/agent-session.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import type { Settings, SettingsManager } from "../../src/core/settings-manager.ts";
import type { InlineExtension, ResourceLoader } from "../../src/index.ts";
import type { CreateTestExtensionsResultInput } from "../utilities.ts";
import type { FauxResponseInput } from "./faux-model.ts";
import type { FauxStreamFnState } from "./faux-stream.ts";

export interface HarnessOptions {
  responses?: FauxResponseInput[];
  model?: Model<any>;
  contextWindow?: number;
  settings?: Partial<Settings>;
  systemPrompt?: string;
  tools?: AgentTool[];
  baseToolsOverride?: Record<string, AgentTool>;
  resourceLoader?: ResourceLoader;
  extensionFactories?: Array<InlineExtension | CreateTestExtensionsResultInput>;
}

export interface Harness {
  session: AgentSession;
  agent: Agent;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  faux: FauxStreamFnState;
  events: AgentSessionEvent[];
  eventsOfType<T extends AgentSessionEvent["type"]>(
    type: T,
  ): Extract<AgentSessionEvent, { type: T }>[];
  tempDir: string;
  cleanup: () => void;
}
