import type aiTypes from "@msa/ai/index.types";

import { LoginFlow, type LoginFlowHost } from "../../../src/modes/interactive/login-flow.ts";

function complete(
  host: object,
  providerId: string,
  providerName: string,
  authType: "oauth" | "api_key",
  previousModel: aiTypes.Model<aiTypes.Api>,
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
