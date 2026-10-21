declare namespace authCheckTypes {
  type AuthCheckStatus = "ready" | "not_ready" | "invalid";

  type AuthCheckReason =
    | "provider_not_found"
    | "credentials_not_configured"
    | "credential_not_available"
    | "invalid_state";

  interface AuthCheckResult {
    status: AuthCheckStatus;
    provider: string;
    reason?: AuthCheckReason;
    authType?: "api_key" | "oauth";
  }
}

export type { authCheckTypes as default };
