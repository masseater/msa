import agentSessionModelExtensionCases1 from "./agent-session-model-extension-cases-1.ts";
import agentSessionModelExtensionCases2 from "./agent-session-model-extension-cases-2.ts";
import agentSessionModelExtensionCases3 from "./agent-session-model-extension-cases-3.ts";

const agentSessionModelExtensionCases = {
  allowsBeforeAgentStartHandlersTo:
    agentSessionModelExtensionCases3.allowsBeforeAgentStartHandlersTo,
  allowsExtensionCommandsToInspectLive:
    agentSessionModelExtensionCases3.allowsExtensionCommandsToInspectLive,
  allowsExtensionContextHandlersToModify:
    agentSessionModelExtensionCases2.allowsExtensionContextHandlersToModify,
  allowsExtensionInputHandlersToTransform:
    agentSessionModelExtensionCases3.allowsExtensionInputHandlersToTransform,
  allowsExtensionToolCallHandlersTo:
    agentSessionModelExtensionCases2.allowsExtensionToolCallHandlersTo,
  allowsExtensionToolCallHandlersToPart2:
    agentSessionModelExtensionCases2.allowsExtensionToolCallHandlersToPart2,
  allowsExtensionToolResultHandlersTo:
    agentSessionModelExtensionCases2.allowsExtensionToolResultHandlersTo,
  appliesPerModelThinkingLevelOverride:
    agentSessionModelExtensionCases1.appliesPerModelThinkingLevelOverride,
  bindextensionsEmitsSessionStartAndReload:
    agentSessionModelExtensionCases3.bindextensionsEmitsSessionStartAndReload,
  clampsThinkingLevelsToModelCapabilities:
    agentSessionModelExtensionCases1.clampsThinkingLevelsToModelCapabilities,
  cyclemodelAndCyclethinkinglevelAreSessionOnly:
    agentSessionModelExtensionCases1.cyclemodelAndCyclethinkinglevelAreSessionOnly,
  cyclesThroughScopedModelsAndPreserves:
    agentSessionModelExtensionCases1.cyclesThroughScopedModelsAndPreserves,
  cyclesXhighBeforeMaxWhenBoth: agentSessionModelExtensionCases1.cyclesXhighBeforeMaxWhenBoth,
  fallsBackToCurrentSessionThinking:
    agentSessionModelExtensionCases1.fallsBackToCurrentSessionThinking,
  harnesses: agentSessionModelExtensionCases1.harnesses,
  onlyPersistsModelAndThinkingDefaults:
    agentSessionModelExtensionCases1.onlyPersistsModelAndThinkingDefaults,
  perModelOverrideTakesPriorityOver:
    agentSessionModelExtensionCases1.perModelOverrideTakesPriorityOver,
  persistsTheRequestedDefaultThinkingLevel:
    agentSessionModelExtensionCases1.persistsTheRequestedDefaultThinkingLevel,
  setmodelSavesTheModelToThe: agentSessionModelExtensionCases1.setmodelSavesTheModelToThe,
  throwsWhenSetmodelIsCalledWithout:
    agentSessionModelExtensionCases1.throwsWhenSetmodelIsCalledWithout,
};

export default agentSessionModelExtensionCases;
