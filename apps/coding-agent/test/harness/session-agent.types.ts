import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type { Settings } from "../../src/core/settings-manager.ts";
import type fauxModelTypes from "./faux-model.types.ts";

declare namespace sessionAgentTypes {
  interface AgentBuildInput {
    readonly model: aiTypes.Model<any>;
    readonly systemPrompt: string;
    readonly tools: ReadonlyArray<agentTypes.AgentTool>;
    readonly responses: fauxModelTypes.FauxResponseInput[];
    readonly tempDir: string;
    readonly settings: Partial<Settings> | undefined;
  }
}

export type { sessionAgentTypes as default };
