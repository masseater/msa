import type agentSessionTypes from "../../../core/agent-session.types.ts";
import type footerDataProviderTypes from "../../../core/footer-data-provider.types.ts";
import type footerInternalTypes from "./footer-internal.types.ts";

export default abstract class FooterComponentLayer0 {
  constructor(
    session: agentSessionTypes.AgentSession,
    footerData: footerDataProviderTypes.ReadonlyFooterDataProvider,
  ) {
    this.session = session;
    this.footerData = footerData;
  }

  protected autoCompactEnabled = true;
  session!: agentSessionTypes.AgentSession;
  footerData!: footerDataProviderTypes.ReadonlyFooterDataProvider;
  sessionStats?: footerInternalTypes.SessionStats;
}
