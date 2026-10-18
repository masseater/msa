import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import {
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
} from "./agent-session-model-extension-cases.ts";

describe("AgentSession model and extension characterization", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("setModel saves the model to the session and emits model_select", () =>
    Effect.runPromise(setmodelSavesTheModelToThe));
  it("only persists model and thinking defaults when requested", () =>
    Effect.runPromise(onlyPersistsModelAndThinkingDefaults));
  it("persists the requested default thinking level even when the current model clamps it", () =>
    Effect.runPromise(persistsTheRequestedDefaultThinkingLevel));
  it("cycleModel and cycleThinkingLevel are session-only by default", () =>
    Effect.runPromise(cyclemodelAndCyclethinkinglevelAreSessionOnly));
  it("applies per-model thinking level override on model switch", () =>
    Effect.runPromise(appliesPerModelThinkingLevelOverride));
  it("falls back to current session thinking level when no per-model or global default is configured", () =>
    Effect.runPromise(fallsBackToCurrentSessionThinking));
  it("per-model override takes priority over global default during model switch", () =>
    Effect.runPromise(perModelOverrideTakesPriorityOver));
  it("cycles through scoped models and preserves the scoped thinking preference", () =>
    Effect.runPromise(cyclesThroughScopedModelsAndPreserves));
  it("clamps thinking levels to model capabilities and cycles available levels", () =>
    Effect.runPromise(clampsThinkingLevelsToModelCapabilities));
  it("cycles xhigh before max when both are supported", () =>
    Effect.runPromise(cyclesXhighBeforeMaxWhenBoth));
  it("throws when setModel is called without configured auth", () =>
    Effect.runPromise(throwsWhenSetmodelIsCalledWithout));
  it("allows extension tool_call handlers to block tool execution", () =>
    Effect.runPromise(allowsExtensionToolCallHandlersTo));
  it("allows extension tool_result handlers to modify tool results", () =>
    Effect.runPromise(allowsExtensionToolResultHandlersTo));
  it("allows extension context handlers to modify messages before the LLM call", () =>
    Effect.runPromise(allowsExtensionContextHandlersToModify));
  it("allows extension input handlers to transform or handle input", () =>
    Effect.runPromise(allowsExtensionInputHandlersToTransform));
  it("allows extension commands to inspect live system prompt options", () =>
    Effect.runPromise(allowsExtensionCommandsToInspectLive));
  it("allows before_agent_start handlers to inject custom messages and modify the system prompt", () =>
    Effect.runPromise(allowsBeforeAgentStartHandlersTo));
  it("bindExtensions emits session_start and reload emits session_shutdown then session_start", () =>
    Effect.runPromise(bindextensionsEmitsSessionStartAndReload));
});
