declare namespace agentsTypes {
  type AgentScope = "user" | "project" | "both";

  interface AgentConfig {
    name: string;
    description: string;
    tools?: string[] | undefined;
    model?: string | undefined;
    systemPrompt: string;
    source: "user" | "project";
    filePath: string;
  }

  interface AgentDiscoveryResult {
    agents: AgentConfig[];
    projectAgentsDir: string | null;
  }
}

export type { agentsTypes as default };
