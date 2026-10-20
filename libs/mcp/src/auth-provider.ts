declare namespace authProviderTypes {
  type McpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

  interface UnauthorizedContext {
    response: Response;
    serverUrl: URL;
    fetch: McpFetch;
    token?: string | undefined;
  }

  interface AuthProvider {
    token(): Promise<string | undefined>;
    onUnauthorized?(context: UnauthorizedContext): Promise<void>;
  }
}

export type { authProviderTypes as default };
