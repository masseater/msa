import type { AgentTool } from "@msa/agent-core";
import type { Model } from "@msa/ai";

import type { Settings } from "../../src/core/settings-manager.ts";
import type fauxModelTypes from "./faux-model.types.ts";

declare namespace sessionAgentTypes {
  interface AgentBuildInput {
    readonly model: Model<any>;
    readonly systemPrompt: string;
    readonly tools: ReadonlyArray<AgentTool>;
    readonly responses: fauxModelTypes.FauxResponseInput[];
    readonly tempDir: string;
    readonly settings: Partial<Settings> | undefined;
  }
}

export type { sessionAgentTypes as default };
