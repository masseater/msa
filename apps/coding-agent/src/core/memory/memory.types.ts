import type agentTypes from "@msa/agent-core/index.types";

import type MemoryServiceClass from "./memory-service.ts";

declare namespace memoryTypes {
  interface ResolvedMemorySettings {
    readonly enabled: boolean;
    readonly recall: boolean;
  }

  interface MemoryServiceOptions {
    readonly agentDir: string;
    readonly legacyDatabase: string;
    readonly cwd: string;
    readonly settings: () => ResolvedMemorySettings;
    readonly tool: () => agentTypes.AgentTool | undefined;
  }

  interface MigrationResult {
    readonly sent: number;
    readonly skipped: readonly { id: string; secrets: readonly string[] }[];
  }

  type MemoryConnection =
    | { readonly state: "ready" }
    | { readonly state: "missing" | "failing"; readonly detail: string };

  type MemoryService = (typeof MemoryServiceClass)["prototype"];

  type MemoryCommand = { kind: "status" } | { kind: "request"; request: string };
}

export type { memoryTypes as default };
