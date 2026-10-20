import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type { ScopedModel } from "../model-resolver.ts";
import {
  type BuildSystemPromptOptions,
  normalizeBuildSystemPromptOptions,
} from "../system-prompt.ts";
import type {
  ForkHandler,
  NavigateTreeHandler,
  NewSessionHandler,
  ReloadHandler,
  ShutdownHandler,
  SwitchSessionHandler,
} from "./runner-types.ts";
import type { CompactOptions, ContextUsage, ExtensionContextActions } from "./types.ts";

export interface RunnerBindings {
  getModel: () => aiTypes.Model<any> | undefined;
  getScopedModels: () => readonly ScopedModel[];
  isIdleFn: () => boolean;
  isProjectTrustedFn: () => boolean;
  getSignalFn: () => AbortSignal | undefined;
  waitForIdleFn: () => Promise<void>;
  abortFn: () => void;
  hasPendingMessagesFn: () => boolean;
  getContextUsageFn: () => ContextUsage | undefined;
  compactFn: (options?: CompactOptions) => void;
  getSystemPromptFn: () => string;
  getSystemPromptOptionsFn: () => BuildSystemPromptOptions;
  executeToolFn: ExtensionContextActions["executeTool"] | undefined;
  getCallableToolsFn: () => readonly agentTypes.AgentTool[];
  newSessionHandler: NewSessionHandler;
  forkHandler: ForkHandler;
  navigateTreeHandler: NavigateTreeHandler;
  switchSessionHandler: SwitchSessionHandler;
  reloadHandler: ReloadHandler;
  shutdownHandler: ShutdownHandler;
}

export const idleCommandBindings = () => ({
  forkHandler: () => Promise.resolve({ cancelled: false }),
  navigateTreeHandler: () => Promise.resolve({ cancelled: false }),
  newSessionHandler: () => Promise.resolve({ cancelled: false }),
  reloadHandler: () => Promise.resolve(),
  switchSessionHandler: () => Promise.resolve({ cancelled: false }),
  waitForIdleFn: () => Promise.resolve(),
});

export const createBindings = (cwd: string): RunnerBindings => ({
  abortFn: () => {},
  compactFn: () => {},
  executeToolFn: undefined,
  getCallableToolsFn: () => [],
  getContextUsageFn: () => undefined,
  getModel: () => undefined,
  getScopedModels: () => [],
  getSignalFn: () => undefined,
  getSystemPromptFn: () => "",
  getSystemPromptOptionsFn: () => normalizeBuildSystemPromptOptions({ cwd }),
  hasPendingMessagesFn: () => false,
  isIdleFn: () => true,
  isProjectTrustedFn: () => true,
  shutdownHandler: () => {},
  ...idleCommandBindings(),
});

export interface ContextActionsInput {
  bindings: RunnerBindings;
  actions: ExtensionContextActions;
  cwd: string;
}

export const applyContextActions = ({ bindings, actions, cwd }: ContextActionsInput): void => {
  bindings.getModel = actions.getModel;
  bindings.getScopedModels = actions.getScopedModels;
  bindings.isIdleFn = actions.isIdle;
  bindings.isProjectTrustedFn = actions.isProjectTrusted;
  bindings.getSignalFn = actions.getSignal;
  bindings.abortFn = actions.abort;
  bindings.hasPendingMessagesFn = actions.hasPendingMessages;
  bindings.shutdownHandler = actions.shutdown;
  bindings.getContextUsageFn = actions.getContextUsage;
  bindings.compactFn = actions.compact;
  bindings.getSystemPromptFn = actions.getSystemPrompt;
  bindings.getSystemPromptOptionsFn =
    actions.getSystemPromptOptions ?? (() => normalizeBuildSystemPromptOptions({ cwd }));
  bindings.executeToolFn = actions.executeTool;
  bindings.getCallableToolsFn = actions.getCallableTools ?? (() => []);
};
