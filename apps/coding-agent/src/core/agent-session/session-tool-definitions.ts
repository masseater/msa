import type AgentSession from "../agent-session.ts";
import platform from "../platform/index.ts";
import sessionRootsModule from "../session-search/session-roots.ts";
import sessionSearch from "../session-search/session-search.ts";
import type sessionSearchTypes from "../session-search/session-search.types.ts";
import toolsMemory from "../tools/memory.ts";
import modelPolicy from "../tools/model-policy.ts";
import modelUpgrade from "../tools/model-upgrade.ts";
import prWatchModule from "../tools/pr-watch.ts";
import searchSessionsModule from "../tools/search-sessions.ts";

const { join } = platform;
const { createMemoryToolDefinition } = toolsMemory;
const { createModelPolicyToolDefinition } = modelPolicy;
const { createModelUpgradeToolDefinition } = modelUpgrade;
const { createPrWatchToolDefinition } = prWatchModule;
const { createSearchSessionsToolDefinition } = searchSessionsModule;
const { sessionRoots } = sessionRootsModule;

function sessionSearchLocations(session: AgentSession): sessionSearchTypes.Locations {
  return {
    indexPath: join(session.agentDir, "session-index.db"),
    orchestratorDatabase: session.settingsManager.session.getOrchestratorDatabasePath(
      session.agentDir,
    ),
    roots: sessionRoots([
      join(session.agentDir, "sessions"),
      session.settingsManager.session.getSessionDir(),
      session.sessionManager.getSessionDir(),
    ]),
  };
}

function sessionSearchService(session: AgentSession) {
  const locations = sessionSearchLocations(session);
  return {
    read: (request: { path: string; entry: string; from: number }) =>
      sessionSearch.readSession(locations, { ...request, after: 10, before: 2 }),
    search: (query: string) =>
      sessionSearch.searchSessions(locations, {
        filters: {},
        limit: 50,
        order: "relevance",
        query,
      }),
  };
}

function sessionToolDefinitions(session: AgentSession): Record<string, unknown> {
  const settings = session.settingsManager;
  const memory = session.integrations.memory.memoryInternal;
  const modelRuntime = session.models.selection.modelRuntimeInternal;
  return {
    ...(memory === undefined ? {} : { memory: createMemoryToolDefinition(memory) }),
    model_policy: createModelPolicyToolDefinition({
      currentModel: () => session.model,
      modelRuntime,
      settingsManager: settings,
    }),
    model_upgrade: createModelUpgradeToolDefinition({ modelRuntime, settingsManager: settings }),
    pr_watch: createPrWatchToolDefinition(session.integrations.prWatch.prWatchInternal),
    search_sessions: createSearchSessionsToolDefinition(sessionSearchLocations(session)),
  };
}

const sessionToolDefinitionsModule = { sessionSearchService, sessionToolDefinitions };

export default sessionToolDefinitionsModule;
