declare namespace managementHttpTypes {
  interface FetchRetryOptions {
    maxRetries?: number;

    retryOnStatus?: boolean;

    timeoutMs?: number;

    attemptTimeoutMs?: number;
  }
}

export type { managementHttpTypes as default };
