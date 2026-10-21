import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import agentSessionModelExtensionCases from "./agent-session-model-extension-cases.ts";

const {
  allowsBeforeAgentStartHandlersTo,
  allowsExtensionCommandsToInspectLive,
  allowsExtensionContextHandlersToModify,
  allowsExtensionInputHandlersToTransform,
  allowsExtensionToolCallHandlersTo,
  allowsExtensionToolResultHandlersTo,
  appliesPerModelThinkingLevelOverride,
  bindextensionsEmitsSessionStartAndReload,
  clampsThinkingLevelsToModelCapabilities,
  cyclemodelAndCyclethinkinglevelAreSessionOnly,
  cyclesThroughScopedModelsAndPreserves,
  cyclesXhighBeforeMaxWhenBoth,
  fallsBackToCurrentSessionThinking,
  harnesses,
  onlyPersistsModelAndThinkingDefaults,
  perModelOverrideTakesPriorityOver,
  persistsTheRequestedDefaultThinkingLevel,
  setmodelSavesTheModelToThe,
  throwsWhenSetmodelIsCalledWithout,
} = agentSessionModelExtensionCases;

const setmodelSavesTheModelToTheSession = () => Effect.runPromise(setmodelSavesTheModelToThe);

const onlyPersistsModelAndThinkingDefaultsWhen = () =>
  Effect.runPromise(onlyPersistsModelAndThinkingDefaults);

const persistsTheRequestedDefaultThinkingLevelEven = () =>
  Effect.runPromise(persistsTheRequestedDefaultThinkingLevel);

const cyclemodelAndCyclethinkinglevelAreSessionOnlyBy = () =>
  Effect.runPromise(cyclemodelAndCyclethinkinglevelAreSessionOnly);

const appliesPerModelThinkingLevelOverrideOn = () =>
  Effect.runPromise(appliesPerModelThinkingLevelOverride);

const fallsBackToCurrentSessionThinkingLevel = () =>
  Effect.runPromise(fallsBackToCurrentSessionThinking);

const perModelOverrideTakesPriorityOverGlobal = () =>
  Effect.runPromise(perModelOverrideTakesPriorityOver);

const cyclesThroughScopedModelsAndPreservesThe = () =>
  Effect.runPromise(cyclesThroughScopedModelsAndPreserves);

const clampsThinkingLevelsToModelCapabilitiesAnd = () =>
  Effect.runPromise(clampsThinkingLevelsToModelCapabilities);

const cyclesXhighBeforeMaxWhenBothAre = () => Effect.runPromise(cyclesXhighBeforeMaxWhenBoth);

const throwsWhenSetmodelIsCalledWithoutConfigured = () =>
  Effect.runPromise(throwsWhenSetmodelIsCalledWithout);

const allowsExtensionToolCallHandlersToBlock = () =>
  Effect.runPromise(allowsExtensionToolCallHandlersTo);

const allowsExtensionToolResultHandlersToModify = () =>
  Effect.runPromise(allowsExtensionToolResultHandlersTo);

const allowsExtensionContextHandlersToModifyMessages = () =>
  Effect.runPromise(allowsExtensionContextHandlersToModify);

const allowsExtensionInputHandlersToTransformOr = () =>
  Effect.runPromise(allowsExtensionInputHandlersToTransform);

const allowsExtensionCommandsToInspectLiveSystem = () =>
  Effect.runPromise(allowsExtensionCommandsToInspectLive);

const allowsBeforeAgentStartHandlersToInject = () =>
  Effect.runPromise(allowsBeforeAgentStartHandlersTo);

const bindextensionsEmitsSessionStartAndReloadEmits = () =>
  Effect.runPromise(bindextensionsEmitsSessionStartAndReload);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("AgentSession model and extension characterization", () => {
  afterEach(afterEachHook);

  it(
    "setModel saves the model to the session and emits model_select",
    setmodelSavesTheModelToTheSession,
  );

  it(
    "only persists model and thinking defaults when requested",
    onlyPersistsModelAndThinkingDefaultsWhen,
  );

  it(
    "persists the requested default thinking level even when the current model clamps it",
    persistsTheRequestedDefaultThinkingLevelEven,
  );

  it(
    "cycleModel and cycleThinkingLevel are session-only by default",
    cyclemodelAndCyclethinkinglevelAreSessionOnlyBy,
  );

  it(
    "applies per-model thinking level override on model switch",
    appliesPerModelThinkingLevelOverrideOn,
  );

  it(
    "falls back to current session thinking level when no per-model or global default is configured",
    fallsBackToCurrentSessionThinkingLevel,
  );

  it(
    "per-model override takes priority over global default during model switch",
    perModelOverrideTakesPriorityOverGlobal,
  );
});

describe("AgentSession model and extension characterization", () => {
  afterEach(afterEachHook);

  it(
    "cycles through scoped models and preserves the scoped thinking preference",
    cyclesThroughScopedModelsAndPreservesThe,
  );

  it(
    "clamps thinking levels to model capabilities and cycles available levels",
    clampsThinkingLevelsToModelCapabilitiesAnd,
  );

  it("cycles xhigh before max when both are supported", cyclesXhighBeforeMaxWhenBothAre);

  it(
    "throws when setModel is called without configured auth",
    throwsWhenSetmodelIsCalledWithoutConfigured,
  );

  it(
    "allows extension tool_call handlers to block tool execution",
    allowsExtensionToolCallHandlersToBlock,
  );

  it(
    "allows extension tool_result handlers to modify tool results",
    allowsExtensionToolResultHandlersToModify,
  );

  it(
    "allows extension context handlers to modify messages before the LLM call",
    allowsExtensionContextHandlersToModifyMessages,
  );
});

describe("AgentSession model and extension characterization", () => {
  afterEach(afterEachHook);

  it(
    "allows extension input handlers to transform or handle input",
    allowsExtensionInputHandlersToTransformOr,
  );

  it(
    "allows extension commands to inspect live system prompt options",
    allowsExtensionCommandsToInspectLiveSystem,
  );

  it(
    "allows before_agent_start handlers to inject custom messages and modify the system prompt",
    allowsBeforeAgentStartHandlersToInject,
  );

  it(
    "bindExtensions emits session_start and reload emits session_shutdown then session_start",
    bindextensionsEmitsSessionStartAndReloadEmits,
  );
});
