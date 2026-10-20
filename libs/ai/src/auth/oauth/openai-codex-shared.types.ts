declare namespace openaiCodexSharedTypes {
  interface OAuthToken {
    readonly access: string;
    readonly refresh: string;
    readonly expires: number;
  }

  interface CodeExchange {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
    readonly signal: AbortSignal;
  }

  interface TokenRefresh {
    readonly refreshToken: string;
    readonly signal: AbortSignal;
  }
}

export type { openaiCodexSharedTypes as default };
