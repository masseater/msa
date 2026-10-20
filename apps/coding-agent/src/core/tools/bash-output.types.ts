import type agentTypes from "@msa/agent-core/index.types";

import type BashOutputReporterClass from "./bash-output.ts";
import type truncateTypes from "./truncate.types.ts";

declare namespace bashOutputTypes {
  interface BashToolDetails {
    truncation?: truncateTypes.TruncationResult | undefined;
    fullOutputPath?: string | undefined;
  }

  type BashUpdateCallback = (
    partial: agentTypes.AgentToolResult<BashToolDetails | undefined>,
  ) => void;

  type BashOutputReporter = (typeof BashOutputReporterClass)["prototype"];
}

export type { bashOutputTypes as default };
