import type openaiCodexRetry from "./openai-codex-retry.ts";

declare namespace openaiCodexRetryTypes {
  interface FailedAttempt {
    readonly status: number;
    readonly errorText: string;
  }

  interface CodexErrorDescription {
    readonly message: string;
    readonly friendlyMessage?: string | undefined;
  }

  type RetryDelayExceededError = (typeof openaiCodexRetry.RetryDelayExceededError)["prototype"];
}

export type { openaiCodexRetryTypes as default };
