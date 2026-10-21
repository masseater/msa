import agentSessionRuntimeSupport from "../core/agent-session-runtime-support.ts";
import AgentSessionRuntime from "../core/agent-session-runtime.ts";
import agentSessionServices from "../core/agent-session-services.ts";
import AgentSession from "../core/agent-session.ts";
import compaction from "../core/compaction/index.ts";
import messages from "../core/messages.ts";
import sdk from "../core/sdk.ts";
import SessionManager from "../core/session-manager.ts";
import sessionContext from "../core/session-manager/session-context.ts";
import sessionFormat from "../core/session-manager/session-format.ts";

const sessionKit: {
  readonly AgentSession: typeof AgentSession;
  readonly AgentSessionRuntime: typeof AgentSessionRuntime;
  readonly CURRENT_SESSION_VERSION: typeof sessionFormat.CURRENT_SESSION_VERSION;
  readonly DEFAULT_COMPACTION_SETTINGS: typeof compaction.DEFAULT_COMPACTION_SETTINGS;
  readonly SessionManager: typeof SessionManager;
  readonly buildContextEntries: typeof sessionContext.buildContextEntries;
  readonly buildSessionContext: typeof sessionContext.buildSessionContext;
  readonly buildSessionProjection: typeof sessionContext.buildSessionProjection;
  readonly calculateContextTokens: typeof compaction.calculateContextTokens;
  readonly collectEntriesForBranchSummary: typeof compaction.collectEntriesForBranchSummary;
  readonly compact: typeof compaction.compact;
  readonly convertToLlm: typeof messages.convertToLlm;
  readonly createAgentSession: typeof sdk.createAgentSession;
  readonly createAgentSessionFromServices: typeof agentSessionServices.createAgentSessionFromServices;
  readonly createAgentSessionRuntime: typeof agentSessionRuntimeSupport.createAgentSessionRuntime;
  readonly createAgentSessionServices: typeof agentSessionServices.createAgentSessionServices;
  readonly createBashTool: typeof sdk.createBashTool;
  readonly createCodingTools: typeof sdk.createCodingTools;
  readonly createEditTool: typeof sdk.createEditTool;
  readonly createFindTool: typeof sdk.createFindTool;
  readonly createGrepTool: typeof sdk.createGrepTool;
  readonly createLsTool: typeof sdk.createLsTool;
  readonly createPowerShellTool: typeof sdk.createPowerShellTool;
  readonly createReadOnlyTools: typeof sdk.createReadOnlyTools;
  readonly createReadTool: typeof sdk.createReadTool;
  readonly createWriteTool: typeof sdk.createWriteTool;
  readonly estimateTokens: typeof compaction.estimateTokens;
  readonly findCutPoint: typeof compaction.findCutPoint;
  readonly findTurnStartIndex: typeof compaction.findTurnStartIndex;
  readonly generateBranchSummary: typeof compaction.generateBranchSummary;
  readonly generateSummary: typeof compaction.generateSummary;
  readonly generateSummaryWithUsage: typeof compaction.generateSummaryWithUsage;
  readonly getLastAssistantUsage: typeof compaction.getLastAssistantUsage;
  readonly getLatestCompactionEntry: typeof sessionContext.getLatestCompactionEntry;
  readonly migrateSessionEntries: typeof sessionFormat.migrateSessionEntries;
  readonly parseSessionEntries: typeof sessionFormat.parseSessionEntries;
  readonly prepareBranchEntries: typeof compaction.prepareBranchEntries;
  readonly serializeConversation: typeof compaction.serializeConversation;
  readonly sessionEntryToContextMessages: typeof sessionContext.sessionEntryToContextMessages;
  readonly shouldCompact: typeof compaction.shouldCompact;
} = {
  AgentSession,
  AgentSessionRuntime,
  CURRENT_SESSION_VERSION: sessionFormat.CURRENT_SESSION_VERSION,
  DEFAULT_COMPACTION_SETTINGS: compaction.DEFAULT_COMPACTION_SETTINGS,
  SessionManager,
  buildContextEntries: sessionContext.buildContextEntries,
  buildSessionContext: sessionContext.buildSessionContext,
  buildSessionProjection: sessionContext.buildSessionProjection,
  calculateContextTokens: compaction.calculateContextTokens,
  collectEntriesForBranchSummary: compaction.collectEntriesForBranchSummary,
  compact: compaction.compact,
  convertToLlm: messages.convertToLlm,
  createAgentSession: sdk.createAgentSession,
  createAgentSessionFromServices: agentSessionServices.createAgentSessionFromServices,
  createAgentSessionRuntime: agentSessionRuntimeSupport.createAgentSessionRuntime,
  createAgentSessionServices: agentSessionServices.createAgentSessionServices,
  createBashTool: sdk.createBashTool,
  createCodingTools: sdk.createCodingTools,
  createEditTool: sdk.createEditTool,
  createFindTool: sdk.createFindTool,
  createGrepTool: sdk.createGrepTool,
  createLsTool: sdk.createLsTool,
  createPowerShellTool: sdk.createPowerShellTool,
  createReadOnlyTools: sdk.createReadOnlyTools,
  createReadTool: sdk.createReadTool,
  createWriteTool: sdk.createWriteTool,
  estimateTokens: compaction.estimateTokens,
  findCutPoint: compaction.findCutPoint,
  findTurnStartIndex: compaction.findTurnStartIndex,
  generateBranchSummary: compaction.generateBranchSummary,
  generateSummary: compaction.generateSummary,
  generateSummaryWithUsage: compaction.generateSummaryWithUsage,
  getLastAssistantUsage: compaction.getLastAssistantUsage,
  getLatestCompactionEntry: sessionContext.getLatestCompactionEntry,
  migrateSessionEntries: sessionFormat.migrateSessionEntries,
  parseSessionEntries: sessionFormat.parseSessionEntries,
  prepareBranchEntries: compaction.prepareBranchEntries,
  serializeConversation: compaction.serializeConversation,
  sessionEntryToContextMessages: sessionContext.sessionEntryToContextMessages,
  shouldCompact: compaction.shouldCompact,
};

export default sessionKit;
