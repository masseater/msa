import type aiTypes from "@msa/ai/index.types";

import LoginFlow from "../../../src/modes/interactive/login-flow.ts";
import type loginFlowTypes from "../../../src/modes/interactive/login-flow.types.ts";

function complete(
  host: object,
  providerId: string,
  providerName: string,
  authType: "oauth" | "api_key",
  previousModel: aiTypes.Model<aiTypes.Api>,
): Promise<void> {
  return new LoginFlow(host as loginFlowTypes.LoginFlowHost).completeProviderAuthentication(
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
