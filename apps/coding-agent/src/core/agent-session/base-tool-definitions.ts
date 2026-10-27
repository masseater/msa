import type AgentSession from "../agent-session.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import ghGuard from "../orchestrator/gh-guard.ts";
import orchestratorTools from "../orchestrator/tools.ts";
import toolsModule from "../tools/index.ts";
import toolDefinitionWrapper from "../tools/tool-definition-wrapper.ts";
import sessionToolDefinitionsModule from "./session-tool-definitions.ts";

const { createAllToolDefinitions } = toolsModule;
const { sessionToolDefinitions } = sessionToolDefinitionsModule;
const { createToolDefinitionFromAgentTool } = toolDefinitionWrapper;
const { createOrchestratorToolDefinitions } = orchestratorTools;

type Definitions = Map<string, extensionsTypes.ToolDefinition>;

const asDefinitions = (definitions: Record<string, unknown>): Definitions =>
  new Map(
    Object.entries(definitions).map(([name, tool]) => [
      name,
      tool as extensionsTypes.ToolDefinition,
    ]),
  );

function defaultDefinitions(session: AgentSession): Record<string, unknown> {
  const settings = session.settingsManager;
  const spawnHook = session.tools.policy.worker ? ghGuard.spawnHook(session.agentDir) : undefined;
  return {
    ...createAllToolDefinitions(session.cwd, {
      bash: {
        commandPrefix: settings.resources.getShellCommandPrefix(),
        shellPath: settings.resources.getShellPath(),
        ...(spawnHook === undefined ? {} : { spawnHook }),
      },
      ...(spawnHook === undefined ? {} : { powershell: { spawnHook } }),
      read: { autoResizeImages: settings.display.getImageAutoResize() },
    }),
    ...sessionToolDefinitions(session),
  };
}

function createBaseToolDefinitions(session: AgentSession): Definitions {
  const override = session.tools.registry.baseToolsOverride;
  if (override !== undefined) {
    return asDefinitions(
      Object.fromEntries(
        Object.entries(override).map(([name, tool]) => [
          name,
          createToolDefinitionFromAgentTool(tool),
        ]),
      ),
    );
  }
  const definitions = asDefinitions(defaultDefinitions(session));
  const orchestrator = session.integrations.orchestration.orchestratorInternal;
  if (orchestrator === undefined) return definitions;
  for (const [name, tool] of Object.entries(createOrchestratorToolDefinitions(orchestrator)))
    definitions.set(name, tool);
  return definitions;
}

const baseToolDefinitions = { createBaseToolDefinitions };

export default baseToolDefinitions;
