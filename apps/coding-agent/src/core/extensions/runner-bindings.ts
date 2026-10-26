import systemPrompt from "../system-prompt.ts";
import type runnerBindingsTypes from "./runner-bindings.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

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

const applyRuntimeActions = (
  runtime: extensionsTypesTypes.ExtensionRuntime,
  actions: extensionsTypesTypes.ExtensionActions,
): void => {
  runtime.sendMessage = actions.sendMessage;
  runtime.sendUserMessage = actions.sendUserMessage;
  runtime.appendEntry = actions.appendEntry;
  runtime.setSessionName = actions.setSessionName;
  runtime.getSessionName = actions.getSessionName;
  runtime.setLabel = actions.setLabel;
  runtime.getActiveTools = actions.getActiveTools;
  runtime.getAllTools = actions.getAllTools;
  runtime.getSettings = actions.getSettings;
  runtime.setActiveTools = actions.setActiveTools;
  runtime.refreshTools = actions.refreshTools;
  runtime.getCommands = actions.getCommands;
  runtime.setModel = actions.setModel;
  runtime.getThinkingLevel = actions.getThinkingLevel;
  runtime.setThinkingLevel = actions.setThinkingLevel;
};

const applyCommandActions = (
  bindings: runnerBindingsTypes.RunnerBindings,
  actions?: extensionsTypesTypes.ExtensionCommandContextActions,
): void => {
  const next =
    actions === undefined
      ? idleCommandBindings()
      : {
          forkHandler: actions.fork,
          navigateTreeHandler: actions.navigateTree,
          newSessionHandler: actions.newSession,
          reloadHandler: actions.reload,
          switchSessionHandler: actions.switchSession,
          waitForIdleFn: actions.waitForIdle,
        };
  bindings.forkHandler = next.forkHandler;
  bindings.navigateTreeHandler = next.navigateTreeHandler;
  bindings.newSessionHandler = next.newSessionHandler;
  bindings.reloadHandler = next.reloadHandler;
  bindings.switchSessionHandler = next.switchSessionHandler;
  bindings.waitForIdleFn = next.waitForIdleFn;
};

const runnerBindings = {
  applyCommandActions,
  applyContextActions,
  applyRuntimeActions,
  createBindings,
  idleCommandBindings,
};

export default runnerBindings;
