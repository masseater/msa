import systemPrompt from "../system-prompt.ts";
import type runnerBindingsTypes from "./runner-bindings.types.ts";

const { normalizeBuildSystemPromptOptions } = systemPrompt;

const idleCommandBindings = () => ({
  forkHandler: () => Promise.resolve({ cancelled: false }),
  navigateTreeHandler: () => Promise.resolve({ cancelled: false }),
  newSessionHandler: () => Promise.resolve({ cancelled: false }),
  reloadHandler: () => Promise.resolve(),
  switchSessionHandler: () => Promise.resolve({ cancelled: false }),
  waitForIdleFn: () => Promise.resolve(),
});

const createBindings = (cwd: string): runnerBindingsTypes.RunnerBindings => ({
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

const applyContextActions = ({
  bindings,
  actions,
  cwd,
}: runnerBindingsTypes.ContextActionsInput): void => {
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

const runnerBindings = {
  applyContextActions,
  createBindings,
  idleCommandBindings,
};

export default runnerBindings;
