import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import { AgentSession, type AgentSessionEvent } from "../../src/core/agent-session.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import type { ResourceLoader } from "../../src/index.ts";
import fauxModelModule from "./faux-model.ts";
import sessionAgent from "./session-agent.ts";
import type sessionTypesModule from "./session-types.ts";

const { fauxModel } = fauxModelModule;
const { buildAgent } = sessionAgent;

const { removePath } = testing;

const resolveModel = (options: sessionTypesModule.HarnessOptions): aiTypes.Model<any> => {
  const baseModel = options.model ?? fauxModel;
  return options.contextWindow === undefined
    ? baseModel
    : { ...baseModel, contextWindow: options.contextWindow };
};

const harnessOf = (input: {
  readonly session: AgentSession;
  readonly agent: sessionTypesModule.Harness["agent"];
  readonly sessionManager: SessionManager;
  readonly settingsManager: sessionTypesModule.Harness["settingsManager"];
  readonly faux: sessionTypesModule.Harness["faux"];
  readonly events: AgentSessionEvent[];
  readonly tempDir: string;
}): sessionTypesModule.Harness => ({
  agent: input.agent,
  cleanup: () => {
    input.session.dispose();
    Effect.runFork(removePath(input.tempDir));
  },
  events: input.events,
  eventsOfType<T extends AgentSessionEvent["type"]>(type: T) {
    return input.events.filter(
      (event): event is Extract<AgentSessionEvent, { type: T }> => event.type === type,
    );
  },
  faux: input.faux,
  session: input.session,
  sessionManager: input.sessionManager,
  settingsManager: input.settingsManager,
  tempDir: input.tempDir,
});

const buildHarness = Effect.fn("buildHarness")(function* (
  options: sessionTypesModule.HarnessOptions,
  resourceLoader: ResourceLoader,
  tempDir: string,
) {
  const model = resolveModel(options);
  const { agent, faux, modelRuntime } = yield* buildAgent({
    model,
    responses: options.responses ?? ["ok"],
    settings: options.settings,
    systemPrompt: options.systemPrompt ?? "You are a test assistant.",
    tempDir,
    tools: options.tools ?? [],
  });
  const sessionManager = SessionManager.inMemory();
  const settingsManager = createSettingsManager(tempDir, options);
  const session = new AgentSession({
    agent,
    cwd: tempDir,
    modelRuntime,
    resourceLoader,
    sessionManager,
    settingsManager,
    ...(options.baseToolsOverride === undefined
      ? {}
      : { baseToolsOverride: options.baseToolsOverride }),
  });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => {
    events.push(event);
  });
  return harnessOf({ agent, events, faux, session, sessionManager, settingsManager, tempDir });
});

function createSettingsManager(tempDir: string, options: sessionTypesModule.HarnessOptions) {
  const settingsManager = SettingsManager.create(tempDir, tempDir);
  if (options.settings !== undefined) settingsManager.applyOverrides(options.settings);
  return settingsManager;
}

const sessionBuild = {
  buildHarness,
};

export default sessionBuild;
