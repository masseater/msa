declare namespace openaiChatgptTokenTypes {
  interface ChatGPTCodeExchange {
    readonly code: string;
    readonly verifier: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly signal: AbortSignal;
  }
}

export type { openaiChatgptTokenTypes as default };
