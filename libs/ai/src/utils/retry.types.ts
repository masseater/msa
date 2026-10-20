declare namespace retryTypes {
  interface RetryPolicy {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxAgentDelayMs?: number;
  }

  interface RetryCallbacks {
    onRetryScheduled?: (
      attempt: number,
      maxAttempts: number,
      delayMs: number,
      errorMessage: string,
    ) => void | Promise<void>;
    onRetryAttemptStart?: () => void | Promise<void>;
    onRetryFinished?: (
      success: boolean,
      attempt: number,
      finalError?: string,
    ) => void | Promise<void>;
  }
}

export type { retryTypes as default };
