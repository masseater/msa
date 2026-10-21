import type agentSessionTypes from "../../../core/agent-session.types.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type usageTotalsTypes from "../../../core/usage-totals.types.ts";

declare namespace footerInternalTypes {
  interface SessionStats {
    session: agentSessionTypes.AgentSession;
    sessionId: string;
    leafId: string | null;
    entryCount: number;
    limitsModel: unknown;
    usageTotals: usageTotalsTypes.UsageTotals;
    latestCacheHitRate: number | undefined;
    contextUsage: extensionsTypesTypes.ContextUsage | undefined;
  }
}

export type { footerInternalTypes as default };
