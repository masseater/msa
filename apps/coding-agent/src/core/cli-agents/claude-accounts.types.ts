import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";

declare namespace claudeAccountsTypes {
  interface Account {
    name: string;
    configDir?: string;
    tokenCommand?: string;
    auto?: boolean;
  }

  interface AuthStatus {
    loggedIn: boolean;
    email?: string;
    detail?: string;
  }

  interface LoginPrompts {
    askCode(url: string, signal: AbortSignal): Promise<string | undefined>;
  }

  interface AccountBlock {
    until: number;
    reason: string;
    usageLimit?: boolean;
  }

  interface RunFailure {
    error: string;

    cause?: "usage_limit" | SDKAssistantMessageError;

    resetsAt?: number;
  }
}

export type { claudeAccountsTypes as default };
