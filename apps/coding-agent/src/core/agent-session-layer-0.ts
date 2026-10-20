import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionTypes from "./agent-session.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type goalTypes from "./goal.types.ts";
import type messagesTypes from "./messages.types.ts";
import type serviceTypes from "./pr-watch/service.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

export default abstract class AgentSessionLayer0 {
  constructor(config: agentSessionTypes.AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.settingsManager = config.settingsManager;
  }

  readonly agent: agentTypes.Agent;
  readonly sessionManager: sessionManagerTypes.SessionManager;
  readonly settingsManager: settingsManagerTypes.SettingsManager;
  protected scopedModelsInternal!: Array<{
    model: compatTypes.Model<any>;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  }>;
  protected unsubscribeAgent?: (() => void) | undefined;
  protected eventListeners: agentSessionTypes.AgentSessionEventListener[] = [];
  protected isAgentRunActive = false;
  protected agentRunAbortRequested = false;
  protected idleWaitPromise: Promise<void> | undefined;
  protected resolveIdleWait: (() => void) | undefined;
  protected steeringMessages: string[] = [];
  protected followUpMessages: string[] = [];
  protected pendingNextTurnMessages: messagesTypes.CustomMessage[] = [];
  protected pendingCustomMessages: messagesTypes.CustomMessage[] = [];
  protected compactionAbortController: AbortController | undefined = undefined;
  protected autoCompactionAbortController: AbortController | undefined = undefined;
  protected overflowRecoveryAttempted = false;
  protected branchSummaryAbortController: AbortController | undefined = undefined;
  protected retryAbortController: AbortController | undefined = undefined;
  protected retryAttemptInternal = 0;
  protected failedResponse: compatTypes.AssistantMessage | undefined;
  protected readonly bashAbortControllers = new Set<AbortController>();
  protected pendingBashMessages: messagesTypes.BashExecutionMessage[] = [];
  protected extensionRunnerInternal!: extensionsTypes.ExtensionRunner;
  protected turnIndex = 0;
  protected readonly entryIdsByMessage = new WeakMap<object, string>();
  protected readonly boundaryDispatchedMessages = new WeakSet<object>();
  protected lastAssistantMessage: compatTypes.AssistantMessage | undefined;
  protected lastAssistantToolResults: agentTypes.AgentMessage[] = [];
  protected lastActivityOutcome: extensionsTypes.AgentActivityOutcome = "completed";
  protected goalInternal!: goalTypes.GoalLoop;
  protected prWatchInternal!: serviceTypes.PrWatch;
}
