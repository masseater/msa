import testing from "@msa/testing";

import type { ExtensionActions, ExtensionContextActions } from "../src/core/extensions/types.ts";
const { awaited, runTest } = testing;

const extensionActions: ExtensionActions = {
  appendEntry: () => {},
  getActiveTools: () => [],
  getAllTools: () => [],
  getCommands: () => [],
  getSessionName: () => undefined,
  getSettings: () => ({}),
  getThinkingLevel: () => "off",
  refreshTools: () => {},
  sendMessage: () => {},
  sendUserMessage: () => {},
  setActiveTools: () => {},
  setLabel: () => {},
  setModel: () => runTest(awaited(false)),
  setSessionName: () => {},
  setThinkingLevel: () => {},
};

const extensionContextActions: ExtensionContextActions = {
  abort: () => {},
  compact: () => {},
  getContextUsage: () => undefined,
  getModel: () => undefined,
  getScopedModels: () => [],
  getSignal: () => undefined,
  getSystemPrompt: () => "",
  hasPendingMessages: () => false,
  isIdle: () => true,
  isProjectTrusted: () => true,
  shutdown: () => {},
};

const extensionsRunnerSupport = {
  extensionActions,
  extensionContextActions,
};

export default extensionsRunnerSupport;
