import type { Api, Model } from "@msa/ai";

import { LoginFlow, type LoginFlowHost } from "../../../src/modes/interactive/login-flow.ts";
function complete(
  host: object,
  providerId: string,
  providerName: string,
  authType: "oauth" | "api_key",
  previousModel: Model<Api>,
): Promise<void> {
  return new LoginFlow(host as LoginFlowHost).completeProviderAuthentication(
    providerId,
    providerName,
    authType,
    previousModel,
  );
}

const CredentialRefreshHangSupport = {
  complete,
};

export default CredentialRefreshHangSupport;
