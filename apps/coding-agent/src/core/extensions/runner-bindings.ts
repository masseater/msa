import type { AgentTool } from "@msa/agent-core";
import type { Model } from "@msa/ai";

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
  getModel: () => Model<any> | undefined;
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
  getCallableToolsFn: () => readonly AgentTool[];
  newSessionHandler: NewSessionHandler;
  forkHandler: ForkHandler;
  navigateTreeHandler: NavigateTreeHandler;
  switchSessionHandler: SwitchSessionHandler;
  reloadHandler: ReloadHandler;
  shutdownHandler: ShutdownHandler;
}

export const idleCommandBindings = () => ({
  waitForIdleFn: () => Promise.resolve(),
  newSessionHandler: () => Promise.resolve({ cancelled: false }),
  forkHandler: () => Promise.resolve({ cancelled: false }),
  navigateTreeHandler: () => Promise.resolve({ cancelled: false }),
  switchSessionHandler: () => Promise.resolve({ cancelled: false }),
  reloadHandler: () => Promise.resolve(),
});

export const createBindings = (cwd: string): RunnerBindings => ({
  getModel: () => undefined,
  getScopedModels: () => [],
  isIdleFn: () => true,
  isProjectTrustedFn: () => true,
  getSignalFn: () => undefined,
  abortFn: () => {},
  hasPendingMessagesFn: () => false,
  getContextUsageFn: () => undefined,
  compactFn: () => {},
  getSystemPromptFn: () => "",
  getSystemPromptOptionsFn: () => normalizeBuildSystemPromptOptions({ cwd }),
  executeToolFn: undefined,
  getCallableToolsFn: () => [],
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
