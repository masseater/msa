declare namespace anthropicSharedTypes {
  interface TokenPost {
    readonly body: Record<string, string | number>;
    readonly signal: AbortSignal;
    readonly requestFailure: (error: unknown) => Error;
    readonly jsonFailure: (responseBody: string, error: unknown) => Error;
  }

  interface CodeExchange {
    readonly code: string;
    readonly state: string;
    readonly verifier: string;
    readonly redirectUri: string;
    readonly signal: AbortSignal;
  }

  interface TokenRefresh {
    readonly refreshToken: string;
    readonly signal: AbortSignal;
  }

  interface AuthorizeUrl {
    readonly redirectUri: string;
    readonly challenge: string;
    readonly verifier: string;
  }
}

export type { anthropicSharedTypes as default };
