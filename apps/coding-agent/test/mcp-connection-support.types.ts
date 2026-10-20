declare namespace mcpConnectionSupportTypes {
  interface TransportOptions {
    expireFirstCall?: boolean;
    methods?: string[];
    noTools?: boolean;
    resources?: boolean;
  }
}

export type { mcpConnectionSupportTypes as default };
