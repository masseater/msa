import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import type agentSessionTypes from "../../src/core/agent-session.types.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import codingAgent from "../../src/index.ts";
import type srcTypes from "../../src/index.types.ts";
import fauxModelModule from "./faux-model.ts";
import sessionAgent from "./session-agent.ts";
import type sessionTypesModule from "./session-types.ts";

const { AgentSession, SessionManager, SettingsManager } = codingAgent;

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
  readonly session: agentSessionTypes.AgentSession;
  readonly agent: sessionTypesModule.Harness["agent"];
  readonly sessionManager: sessionManagerTypes.SessionManager;
  readonly settingsManager: sessionTypesModule.Harness["settingsManager"];
  readonly faux: sessionTypesModule.Harness["faux"];
  readonly events: agentSessionTypes.AgentSessionEvent[];
  readonly tempDir: string;
}): sessionTypesModule.Harness => ({
  agent: input.agent,
  cleanup: () => {
    input.session.dispose();
    Effect.runFork(removePath(input.tempDir));
  },
  events: input.events,
  eventsOfType<T extends agentSessionTypes.AgentSessionEvent["type"]>(type: T) {
    return input.events.filter(
      (event): event is Extract<agentSessionTypes.AgentSessionEvent, { type: T }> =>
        event.type === type,
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
  resourceLoader: srcTypes.ResourceLoader,
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
  const settingsManager = yield* createSettingsManager(tempDir, options);
  const session = new AgentSession({
    agent,
    agentDir: tempDir,
    cwd: tempDir,
    modelRuntime,
    resourceLoader,
    sessionManager,
    settingsManager,
    ...(options.baseToolsOverride === undefined
      ? {}
      : { baseToolsOverride: options.baseToolsOverride }),
  });
  const events: agentSessionTypes.AgentSessionEvent[] = [];
  session.subscribe((event) => {
    events.push(event);
  });
  return harnessOf({ agent, events, faux, session, sessionManager, settingsManager, tempDir });
});

const createSettingsManager = (tempDir: string, options: sessionTypesModule.HarnessOptions) =>
  Effect.gen(function* () {
    const settingsManager = yield* Effect.promise(() => SettingsManager.create(tempDir, tempDir));
    if (options.settings !== undefined) settingsManager.applyOverrides(options.settings);
    return settingsManager;
  });

const sessionBuild = {
  buildHarness,
};

export default sessionBuild;
