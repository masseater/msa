import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer1 from "./agent-session-layer-1.ts";
import type systemPromptTypes from "./system-prompt.types.ts";

export default abstract class AgentSessionLayer2 extends AgentSessionLayer1 {
  protected toolDefinitions: Map<string, agentSessionInternalTypes.ToolDefinitionEntry> = new Map();
  protected toolPromptSnippets: Map<string, string> = new Map();
  protected toolPromptGuidelines: Map<string, string[]> = new Map();
  protected baseSystemPromptOptions!: systemPromptTypes.NormalizedBuildSystemPromptOptions;
  protected runSystemPromptOptions?:
    | systemPromptTypes.NormalizedBuildSystemPromptOptions
    | undefined;
}
