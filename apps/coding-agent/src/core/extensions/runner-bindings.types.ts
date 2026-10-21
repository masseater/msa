import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type modelResolverTypes from "../model-resolver.types.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
import type runnerTypesTypes from "./runner-types.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace runnerBindingsTypes {
  interface RunnerBindings {
    getModel: () => aiTypes.Model<any> | undefined;
    getScopedModels: () => readonly modelResolverTypes.ScopedModel[];
    isIdleFn: () => boolean;
    isProjectTrustedFn: () => boolean;
    getSignalFn: () => AbortSignal | undefined;
    waitForIdleFn: () => Promise<void>;
    abortFn: () => void;
    hasPendingMessagesFn: () => boolean;
    getContextUsageFn: () => extensionsTypesTypes.ContextUsage | undefined;
    compactFn: (options?: extensionsTypesTypes.CompactOptions) => void;
    getSystemPromptFn: () => string;
    getSystemPromptOptionsFn: () => systemPromptTypes.BuildSystemPromptOptions;
    executeToolFn: extensionsTypesTypes.ExtensionContextActions["executeTool"] | undefined;
    getCallableToolsFn: () => readonly agentTypes.AgentTool[];
    newSessionHandler: runnerTypesTypes.NewSessionHandler;
    forkHandler: runnerTypesTypes.ForkHandler;
    navigateTreeHandler: runnerTypesTypes.NavigateTreeHandler;
    switchSessionHandler: runnerTypesTypes.SwitchSessionHandler;
    reloadHandler: runnerTypesTypes.ReloadHandler;
    shutdownHandler: runnerTypesTypes.ShutdownHandler;
  }

  interface ContextActionsInput {
    bindings: RunnerBindings;
    actions: extensionsTypesTypes.ExtensionContextActions;
    cwd: string;
  }
}

export type { runnerBindingsTypes as default };
