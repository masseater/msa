import type { Model } from "@msa/ai";
import { removePath } from "@msa/testing";
import { Effect } from "effect";

import { AgentSession, type AgentSessionEvent } from "../../src/core/agent-session.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { fauxModel } from "./faux-model.ts";
import { buildAgent } from "./session-agent.ts";
import type { Harness, HarnessOptions } from "./session-types.ts";

const resolveModel = (options: HarnessOptions): Model<any> => {
  const baseModel = options.model ?? fauxModel;
  return options.contextWindow === undefined
    ? baseModel
    : { ...baseModel, contextWindow: options.contextWindow };
};

const harnessOf = (input: {
  readonly session: AgentSession;
  readonly agent: Harness["agent"];
  readonly sessionManager: SessionManager;
  readonly settingsManager: Harness["settingsManager"];
  readonly faux: Harness["faux"];
  readonly events: AgentSessionEvent[];
  readonly tempDir: string;
}): Harness => ({
  session: input.session,
  agent: input.agent,
  sessionManager: input.sessionManager,
  settingsManager: input.settingsManager,
  faux: input.faux,
  events: input.events,
  eventsOfType<T extends AgentSessionEvent["type"]>(type: T) {
    return input.events.filter(
      (event): event is Extract<AgentSessionEvent, { type: T }> => event.type === type,
    );
  },
  tempDir: input.tempDir,
  cleanup: () => {
    input.session.dispose();
    Effect.runFork(removePath(input.tempDir));
  },
});

export const buildHarness = Effect.fn("buildHarness")(function* (
  options: HarnessOptions,
  resourceLoader: ResourceLoader,
  tempDir: string,
) {
  const model = resolveModel(options);
  const { agent, faux, modelRuntime } = yield* buildAgent({
    model,
    systemPrompt: options.systemPrompt ?? "You are a test assistant.",
    tools: options.tools ?? [],
    responses: options.responses ?? ["ok"],
    tempDir,
    settings: options.settings,
  });
  const sessionManager = SessionManager.inMemory();
  const settingsManager = createSettingsManager(tempDir, options);
  const session = new AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd: tempDir,
    modelRuntime,
    resourceLoader,
    ...(options.baseToolsOverride === undefined
      ? {}
      : { baseToolsOverride: options.baseToolsOverride }),
  });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => {
    events.push(event);
  });
  return harnessOf({ session, agent, sessionManager, settingsManager, faux, events, tempDir });
});

function createSettingsManager(tempDir: string, options: HarnessOptions) {
  const settingsManager = SettingsManager.create(tempDir, tempDir);
  if (options.settings !== undefined) settingsManager.applyOverrides(options.settings);
  return settingsManager;
}
